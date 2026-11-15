// Server-owned message metadata. Never expose replies from another conversation.
const TABLE = Object.freeze({ channel: 'messages', dm: 'dm_messages' });
function replyInfo(db,scope,replyId,scopeId) {
  if (!replyId || !TABLE[scope]) return null;
  const column = scope === 'channel' ? 'channel_id' : 'dm_channel_id';
  const p = db.get(
    'SELECT m.id,m.content,u.display_name AS author_name FROM ' + TABLE[scope] + ' m ' +
    'JOIN users u ON u.id=m.author_id WHERE m.id=? AND m.' + column + '=?',
    [replyId,scopeId]
  );
  if (!p) return {id:replyId,author_name:'Mensagem excluída',content:'Mensagem indisponível'};
  return {id:p.id,author_name:p.author_name,content:p.content.slice(0,220)};
}
function reactionsFor(db,scope,messageId,userId) {
  const rows = db.all(
    'SELECT emoji,COUNT(*) AS count, ' +
    'MAX(CASE WHEN user_id=? THEN 1 ELSE 0 END) AS mine ' +
    'FROM message_reactions WHERE scope_type=? AND message_id=? ' +
    'GROUP BY emoji ORDER BY count DESC, emoji LIMIT 24',
    [userId,scope,messageId]
  );
  return rows.map(r=>({emoji:r.emoji,count:Number(r.count),mine:Boolean(r.mine)}));
}
function enrichMessages(db,scope,messages,userId) {
  if (!TABLE[scope]) throw new Error('Invalid message scope');
  const column = scope === 'channel' ? 'channel_id' : 'dm_channel_id';
  return messages.map(m=>({
    ...m,
    reply:replyInfo(db,scope,m.reply_to_id,m[column]),
    reactions:reactionsFor(db,scope,m.id,userId),
  }));
}
module.exports={TABLE,replyInfo,reactionsFor,enrichMessages};
