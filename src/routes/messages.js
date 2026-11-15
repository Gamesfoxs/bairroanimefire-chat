const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authRequired } = require('../middleware/auth');
const storage = require('../media/s3');
const {TABLE,reactionsFor,enrichMessages} = require('../messages/format');

// One emoji toggle per reaction, no arbitrary HTML or huge unicode payloads.
const EMOJIS = new Set(['👍','❤️','😂','🔥','😮','😢','👏','🎮','💜','✨']);

function createMessagesRouter(db,io) {
  const router=express.Router();
  router.use(authRequired);
  const rate=new Map();
  const limiter=setInterval(()=>{
    for(const [key,entry] of rate) if(Date.now()-entry.started>30000)rate.delete(key);
  },30000);
  limiter.unref();

  function access(userId,scope,scopeId) {
    if(scope==='channel') {
      return db.get(
        'SELECT c.id,c.server_id,s.owner_id, ' +
        'CASE WHEN st.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_mod ' +
        'FROM channels c JOIN servers s ON s.id=c.server_id ' +
        'JOIN server_members sm ON sm.server_id=c.server_id AND sm.user_id=? ' +
        'LEFT JOIN server_staff st ON st.server_id=c.server_id AND st.user_id=? ' +
        "WHERE c.id=? AND c.type='text'",
        [userId,userId,scopeId]
      );
    }
    if(scope==='dm') {
      return db.get('SELECT id FROM dm_channels WHERE id=? AND (user1_id=? OR user2_id=?)',
        [scopeId,userId,userId]);
    }
    return null;
  }
  function context(req,res) {
    const scope=req.params.scope || String(req.query.scope||'');
    if(!TABLE[scope]) {res.status(400).json({error:'Conversa inválida'});return null;}
    const scopeId=req.params.scopeId || String(req.query.scope_id||'');
    if(!scopeId || scopeId.length>100) {res.status(400).json({error:'ID da conversa inválido'});return null;}
    const permissions=access(req.user.id,scope,scopeId);
    if(!permissions) {res.status(403).json({error:'Sem acesso à conversa'});return null;}
    return {scope,scopeId,permissions,table:TABLE[scope],
      idColumn:scope==='channel'?'channel_id':'dm_channel_id',
      room:(scope==='channel'?'channel:':'dm:')+scopeId};
  }
  function limit(userId) {
    const now=Date.now(), item=rate.get(userId);
    if(!item||now-item.started>=10000) {rate.set(userId,{started:now,count:1});return true;}
    if(item.count>=30)return false;
    item.count++;
    return true;
  }
  function message(dbContext,id) {
    return db.get('SELECT id,author_id,content,media_id,reply_to_id,edited_at,'+
      dbContext.idColumn+' AS scope_id FROM '+dbContext.table+
      ' WHERE id=? AND '+dbContext.idColumn+'=?',[id,dbContext.scopeId]);
  }
  router.get('/search',(req,res)=>{
    const c=context(req,res);
    if(!c)return;
    const query=String(req.query.q||'').trim();
    if(query.length<2||query.length>120)return res.status(400).json({error:'Busque de 2 a 120 caracteres'});
    // instr() treats % and _ literally: users cannot wildcard or escape the search.
    const messages=db.all(
      'SELECT m.id,m.content,m.created_at,m.'+c.idColumn+',m.media_id,m.reply_to_id,m.edited_at,'+
      'a.mime AS media_type,a.bytes AS media_size,'+
      'u.id AS author_id,u.username AS author_username,u.display_name AS author_display_name,u.avatar_color AS author_color '+
      'FROM '+c.table+' m LEFT JOIN media_uploads a ON a.id=m.media_id '+
      'JOIN users u ON u.id=m.author_id WHERE m.'+c.idColumn+'=? AND instr(lower(m.content),lower(?))>0 '+
      'ORDER BY m.created_at DESC,m.rowid DESC LIMIT 40',
      [c.scopeId,query]
    );
    res.json({messages:enrichMessages(db,c.scope,messages,req.user.id),query});
  });
  router.patch('/:scope/:scopeId/:messageId',(req,res)=>{
    const c=context(req,res);
    if(!c)return;
    if(!limit(req.user.id))return res.status(429).json({error:'Aguarde antes de editar mais mensagens'});
    const item=message(c,req.params.messageId);
    if(!item)return res.status(404).json({error:'Mensagem não encontrada'});
    if(item.author_id!==req.user.id)return res.status(403).json({error:'Apenas o autor pode editar'});
    const content=typeof req.body?.content==='string'?req.body.content.trim():'';
    if(!content||content.length>2000)return res.status(400).json({error:'A mensagem deve ter de 1 a 2000 caracteres'});
    const editedAt=new Date().toISOString();
    db.run('UPDATE '+c.table+' SET content=?,edited_at=? WHERE id=?',[content,editedAt,item.id]);
    io.to(c.room).emit(c.scope==='channel'?'message:updated':'dm:updated',
      {messageId:item.id,content,edited_at:editedAt,scopeId:c.scopeId});
    res.json({ok:true,messageId:item.id,content,edited_at:editedAt});
  });
  router.delete('/:scope/:scopeId/:messageId',(req,res)=>{
    const c=context(req,res);
    if(!c)return;
    if(!limit(req.user.id))return res.status(429).json({error:'Aguarde antes de apagar mais mensagens'});
    const item=message(c,req.params.messageId);
    if(!item)return res.status(404).json({error:'Mensagem não encontrada'});
    const isOwner=c.scope==='channel'&&c.permissions.owner_id===req.user.id;
    const canModerate=c.scope==='channel'&&(isOwner||Boolean(c.permissions.is_mod));
    if(item.author_id!==req.user.id&&!canModerate)return res.status(403).json({error:'Sem permissão para apagar'});
    db.run('DELETE FROM '+c.table+' WHERE id=?',[item.id]);
    db.run('DELETE FROM message_reactions WHERE scope_type=? AND message_id=?',[c.scope,item.id]);
    if(item.media_id) {
      const attachment=db.get('SELECT s3_key FROM media_uploads WHERE id=?',[item.media_id]);
      db.run('UPDATE media_uploads SET status=? WHERE id=?',['deleted',item.media_id]);
      if(attachment)storage.remove(attachment.s3_key).catch(err=>console.error('media removal',err.message));
    }
    if(canModerate&&item.author_id!==req.user.id) {
      db.run('INSERT INTO server_audit(id,server_id,actor_id,action,target_id) VALUES(?,?,?,?,?)',
        [uuidv4(),c.permissions.server_id,req.user.id,'delete_message',item.id]);
    }
    io.to(c.room).emit(c.scope==='channel'?'message:deleted':'dm:deleted',
      {messageId:item.id,channelId:c.scope==='channel'?c.scopeId:undefined,dmId:c.scope==='dm'?c.scopeId:undefined});
    res.json({ok:true});
  });
  router.post('/:scope/:scopeId/:messageId/react',(req,res)=>{
    const c=context(req,res);
    if(!c)return;
    if(!limit(req.user.id))return res.status(429).json({error:'Muitas reações seguidas, aguarde'});
    const item=message(c,req.params.messageId);
    if(!item)return res.status(404).json({error:'Mensagem não encontrada'});
    const emoji=String(req.body?.emoji||'');
    if(!EMOJIS.has(emoji))return res.status(400).json({error:'Emoji não suportado'});
    const existing=db.get('SELECT 1 FROM message_reactions WHERE scope_type=? AND message_id=? AND user_id=? AND emoji=?',
      [c.scope,item.id,req.user.id,emoji]);
    if(existing)db.run('DELETE FROM message_reactions WHERE scope_type=? AND message_id=? AND user_id=? AND emoji=?',
      [c.scope,item.id,req.user.id,emoji]);
    else db.run('INSERT INTO message_reactions(scope_type,message_id,user_id,emoji) VALUES(?,?,?,?)',
      [c.scope,item.id,req.user.id,emoji]);
    const reactions=reactionsFor(db,c.scope,item.id,req.user.id);
    // Individual "mine" flags are calculated on clients after a full refresh.
    io.to(c.room).emit(c.scope==='channel'?'message:reactions':'dm:reactions',
      {messageId:item.id,scopeId:c.scopeId,reactions:reactions.map(({emoji,count})=>({emoji,count}))});
    res.json({ok:true,reactions});
  });
  return router;
}
module.exports={createMessagesRouter,EMOJIS};
