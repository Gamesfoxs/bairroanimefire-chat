const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authRequired } = require('../middleware/auth');
const storage = require('../media/s3');

const IMAGE_LIMIT = 8 * 1024 * 1024;
const VIDEO_LIMIT = 24 * 1024 * 1024;
function inspect(data) {
  if (data.length >= 8 && data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return ['image/png','png',IMAGE_LIMIT];
  if (data.length >= 3 && data.subarray(0,3).equals(Buffer.from([255,216,255]))) return ['image/jpeg','jpg',IMAGE_LIMIT];
  if (data.length >= 6 && ['GIF87a','GIF89a'].includes(data.subarray(0,6).toString('ascii'))) return ['image/gif','gif',IMAGE_LIMIT];
  if (data.length >= 12 && data.subarray(0,4).toString('ascii')==='RIFF' && data.subarray(8,12).toString('ascii')==='WEBP') return ['image/webp','webp',IMAGE_LIMIT];
  if (data.length >= 12 && data.subarray(4,8).toString('ascii')==='ftyp') return ['video/mp4','mp4',VIDEO_LIMIT];
  if (data.length >= 4 && data.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))) return ['video/webm','webm',VIDEO_LIMIT];
  return null;
}
function canAccess(db,userId,scopeType,scopeId) {
  if (scopeType==='channel') {
    return Boolean(db.get('SELECT 1 FROM channels c JOIN server_members sm ON sm.server_id=c.server_id WHERE c.id=? AND c.type=? AND sm.user_id=?',[scopeId,'text',userId]));
  }
  if (scopeType==='dm') {
    return Boolean(db.get('SELECT 1 FROM dm_channels WHERE id=? AND (user1_id=? OR user2_id=?)',[scopeId,userId,userId]));
  }
  return false;
}
function createMediaRouter(db) {
  const router=express.Router();
  router.post('/upload',authRequired,express.raw({type:()=>true,limit:VIDEO_LIMIT}),async(req,res)=>{
    if (!storage.config()) return res.status(503).json({error:'Envio de mídia indisponível: S3 não configurado'});
    const scopeType=String(req.query.scope_type || '');
    const scopeId=String(req.query.scope_id || '');
    if (!canAccess(db,req.user.id,scopeType,scopeId)) return res.status(403).json({error:'Sem acesso a esta conversa'});
    const body=req.body;
    if (!Buffer.isBuffer(body) || body.length===0) return res.status(400).json({error:'Arquivo vazio'});
    const inspected=inspect(body);
    if (!inspected) return res.status(415).json({error:'Envie PNG, JPEG, WEBP, GIF, MP4 ou WEBM'});
    const [mime,ext,limit]=inspected;
    if (body.length>limit) return res.status(413).json({error:'Tamanho máximo: '+(limit/1048576)+' MB'});
    const quota=db.get("SELECT COUNT(*) AS count, COALESCE(SUM(bytes),0) AS total FROM media_uploads WHERE owner_id=? AND created_at>=datetime('now','-1 day')",[req.user.id]);
    if (quota && (quota.count >= 40 || quota.total + body.length > 250 * 1048576)) {
      return res.status(429).json({error:'Limite de mídia diário atingido (40 arquivos ou 250 MB)'});
    }
    const id=uuidv4();
    const key=storage.makeKey(id,scopeType,scopeId,ext);
    try {
      await storage.put(key,body,mime);
    } catch(err) {
      console.error('media upload failed:',err.message);
      return res.status(502).json({error:'Falha ao salvar mídia no S3. Tente novamente.'});
    }
    db.run('INSERT INTO media_uploads(id,owner_id,scope_type,scope_id,s3_key,mime,bytes,status) VALUES(?,?,?,?,?,?,?,?)',
      [id,req.user.id,scopeType,scopeId,key,mime,body.length,'pending']);
    res.status(201).json({media:{id,mime,bytes:body.length}});
  });
  router.get('/:mediaId',authRequired,(req,res)=>{
    const media=db.get('SELECT * FROM media_uploads WHERE id=? AND status=?',[req.params.mediaId,'sent']);
    if (!media) return res.status(404).json({error:'Mídia não encontrada'});
    if (!canAccess(db,req.user.id,media.scope_type,media.scope_id)) return res.status(403).json({error:'Sem acesso'});
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Referrer-Policy','no-referrer');
    res.redirect(302,storage.getUrl(media.s3_key,media.mime.startsWith('video/') ? 600 : 120));
  });
  router.use((err,_req,res,next)=>{
    if (err?.type==='entity.too.large') return res.status(413).json({error:'Arquivo excede 24 MB'});
    if (err?.type==='entity.parse.failed') return res.status(400).json({error:'Arquivo inválido'});
    next(err);
  });
  return router;
}
module.exports={createMediaRouter,inspect,canAccess};
