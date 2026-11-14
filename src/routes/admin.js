const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authRequired } = require('../middleware/auth');
const storage = require('../media/s3');

function createAdminRouter(db, io) {
  const router = express.Router();
  router.use(authRequired);
  function access(serverId, actorId) {
    const server = db.get('SELECT id,name,owner_id,icon_emoji FROM servers WHERE id=?', [serverId]);
    if (!server) return null;
    const isOwner = server.owner_id === actorId;
    const isMember = Boolean(db.get('SELECT 1 FROM server_members WHERE server_id=? AND user_id=?', [serverId, actorId]));
    const mod = isMember && Boolean(db.get('SELECT 1 FROM server_staff WHERE server_id=? AND user_id=?', [serverId, actorId]));
    return {server,isOwner,isMember,canModerate:isOwner || mod};
  }
  function audit(serverId, actorId, action, targetId) {
    db.run('INSERT INTO server_audit(id,server_id,actor_id,action,target_id) VALUES(?,?,?,?,?)',
      [uuidv4(),serverId,actorId,action,targetId || null]);
  }
  async function evict(serverId, userId) {
    const channels=db.all('SELECT id,type FROM channels WHERE server_id=?',[serverId]);
    const sockets=await io.in('user:'+userId).fetchSockets();
    for (const s of sockets) {
      for (const channel of channels) {
        s.leave('channel:'+channel.id);
        s.leave('voice:'+channel.id);
      }
      s.emit('server:removed',{serverId});
    }
  }
  router.get('/:serverId', (req,res) => {
    const a=access(req.params.serverId,req.user.id);
    if (!a) return res.status(404).json({error:'Servidor não encontrado'});
    if (!a.canModerate) return res.status(403).json({error:'Sem permissão de administração'});
    const members=db.all('SELECT u.id,u.display_name,u.username,u.avatar_color,CASE WHEN u.id=? THEN \'owner\' WHEN st.user_id IS NOT NULL THEN \'moderator\' ELSE \'member\' END AS role FROM server_members sm JOIN users u ON u.id=sm.user_id LEFT JOIN server_staff st ON st.server_id=sm.server_id AND st.user_id=sm.user_id WHERE sm.server_id=? ORDER BY role, u.display_name',[a.server.owner_id,a.server.id]);
    const bans=db.all('SELECT b.user_id, u.display_name, u.username,b.reason,b.created_at FROM server_bans b LEFT JOIN users u ON u.id=b.user_id WHERE b.server_id=? ORDER BY b.created_at DESC LIMIT 100',[a.server.id]);
    const auditLog=db.all('SELECT a.action,a.target_id,a.created_at,u.display_name AS actor FROM server_audit a LEFT JOIN users u ON u.id=a.actor_id WHERE a.server_id=? ORDER BY a.created_at DESC LIMIT 30',[a.server.id]);
    res.json({server:a.server,is_owner:a.isOwner,members,bans,audit:auditLog});
  });
  router.patch('/:serverId', (req,res) => {
    const a=access(req.params.serverId,req.user.id);
    if (!a || !a.isOwner) return res.status(403).json({error:'Só o dono pode editar o servidor'});
    const name=String(req.body?.name || '').trim();
    if (name.length<2 || name.length>40) return res.status(400).json({error:'Nome deve ter de 2 a 40 caracteres'});
    db.run('UPDATE servers SET name=? WHERE id=?',[name,a.server.id]);
    audit(a.server.id,req.user.id,'rename',a.server.id);
    io.to('user:'+req.user.id).emit('servers:changed',{serverId:a.server.id});
    res.json({ok:true,name});
  });
  router.put('/:serverId/roles/:userId', (req,res) => {
    const a=access(req.params.serverId,req.user.id);
    if (!a || !a.isOwner) return res.status(403).json({error:'Só o dono pode atribuir cargos'});
    const target=req.params.userId;
    const role=String(req.body?.role || '');
    if (!['moderator','member'].includes(role)) return res.status(400).json({error:'Cargo inválido'});
    if (target===a.server.owner_id) return res.status(403).json({error:'O cargo de dono não pode ser alterado'});
    if (!db.get('SELECT 1 FROM server_members WHERE server_id=? AND user_id=?',[a.server.id,target])) return res.status(404).json({error:'Membro não encontrado'});
    if (role==='moderator') db.run('INSERT OR IGNORE INTO server_staff(server_id,user_id,role) VALUES(?,?,?)',[a.server.id,target,'moderator']);
    else db.run('DELETE FROM server_staff WHERE server_id=? AND user_id=?',[a.server.id,target]);
    audit(a.server.id,req.user.id,'role:'+role,target);
    res.json({ok:true,role});
  });
  function removeMember(req,res,ban) {
    const a=access(req.params.serverId,req.user.id);
    if (!a || !a.canModerate) return res.status(403).json({error:'Sem permissão'});
    const target=req.params.userId;
    if (target===a.server.owner_id || target===req.user.id) return res.status(403).json({error:'Não é possível remover o dono nem a si mesmo'});
    if (!a.isOwner && db.get('SELECT 1 FROM server_staff WHERE server_id=? AND user_id=?',[a.server.id,target])) {
      return res.status(403).json({error:'Moderador não pode remover outro moderador'});
    }
    const member=db.get('SELECT 1 FROM server_members WHERE server_id=? AND user_id=?',[a.server.id,target]);
    if (!member) return res.status(404).json({error:'Membro não encontrado'});
    if (ban) {
      const reason=String(req.body?.reason || '').trim().slice(0,160);
      db.run('INSERT OR REPLACE INTO server_bans(server_id,user_id,created_by,reason) VALUES(?,?,?,?)',[a.server.id,target,req.user.id,reason]);
    }
    db.run('DELETE FROM server_members WHERE server_id=? AND user_id=?',[a.server.id,target]);
    db.run('DELETE FROM server_staff WHERE server_id=? AND user_id=?',[a.server.id,target]);
    audit(a.server.id,req.user.id,ban?'ban':'kick',target);
    evict(a.server.id,target).catch(err=>console.error('admin evict',err.message));
    res.json({ok:true});
  }
  router.post('/:serverId/members/:userId/kick',(req,res)=>removeMember(req,res,false));
  router.post('/:serverId/members/:userId/ban',(req,res)=>removeMember(req,res,true));
  router.delete('/:serverId/bans/:userId',(req,res)=>{
    const a=access(req.params.serverId,req.user.id);
    if (!a || !a.canModerate) return res.status(403).json({error:'Sem permissão'});
    db.run('DELETE FROM server_bans WHERE server_id=? AND user_id=?',[a.server.id,req.params.userId]);
    audit(a.server.id,req.user.id,'unban',req.params.userId);
    res.json({ok:true});
  });
  router.delete('/:serverId/messages/:messageId',(req,res)=>{
    const a=access(req.params.serverId,req.user.id);
    if (!a || !a.isMember) return res.status(403).json({error:'Sem acesso'});
    const msg=db.get('SELECT m.id,m.author_id,m.channel_id,m.media_id FROM messages m JOIN channels c ON c.id=m.channel_id WHERE m.id=? AND c.server_id=?',[req.params.messageId,a.server.id]);
    if (!msg) return res.status(404).json({error:'Mensagem não encontrada'});
    if (msg.author_id!==req.user.id && !a.canModerate) return res.status(403).json({error:'Sem permissão'});
    db.run('DELETE FROM messages WHERE id=?',[msg.id]);
    if (msg.media_id) {
      const attachment=db.get('SELECT s3_key FROM media_uploads WHERE id=?',[msg.media_id]);
      db.run('UPDATE media_uploads SET status=? WHERE id=?',['deleted',msg.media_id]);
      if (attachment) storage.remove(attachment.s3_key).catch(err => console.error('S3 delete failed',err.message));
    }
    audit(a.server.id,req.user.id,'delete_message',msg.id);
    io.to('channel:'+msg.channel_id).emit('message:deleted',{channelId:msg.channel_id,messageId:msg.id});
    res.json({ok:true});
  });
  return router;
}
module.exports={createAdminRouter};
