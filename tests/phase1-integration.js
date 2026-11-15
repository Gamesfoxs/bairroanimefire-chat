// Isolated integration test: synthetic accounts, isolated SQLite database, no production edits.
const fs=require('fs');
const path=require('path');
const assert=require('node:assert/strict');
const WebSocket=require('ws');
const root=path.resolve(__dirname,'..');
const q=JSON.parse(fs.readFileSync(path.join(root,'data/phase1-fixtures.json')));
const cookie=who=>fs.readFileSync(path.join(root,'data/phase1-'+who+'.cookie'),'utf8');
const base='http://127.0.0.1:3037';
async function api(who,url,options={}) {
 const r=await fetch(base+url,{...options,headers:{...(options.headers||{}),...(who?{Cookie:cookie(who)}:{})},redirect:'manual'});
 return {status:r.status,data:await r.json().catch(()=>({}))};
}
function check(result,expected,desc) {
 assert.equal(result.status,expected,desc+': '+JSON.stringify(result.data));
 console.log('PASS',desc);
 return result.data;
}
function json(method,body={}){return {method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}}
class Client {
 constructor(who){this.who=who;this.acks=new Map();this.handlers=new Map();this.next=1;this.ready=null;}
 async connect(){
  this.ready=new Promise((resolve,reject)=>{
   this.ws=new WebSocket('ws://127.0.0.1:3037/socket.io/?EIO=4&transport=websocket',{
    headers:{Cookie:cookie(this.who),Origin:'https://chat.bairroanimefire.com'}
   });
   const timer=setTimeout(()=>reject(new Error('socket connect timeout')),10000);
   this.ws.on('message',raw=>{
    const s=raw.toString();
    if(s[0]==='0')this.ws.send('40');
    else if(s.startsWith('40')){clearTimeout(timer);resolve();}
    else if(s==='2')this.ws.send('3');
    else if(s.startsWith('43')){
     const m=/^43(\d+)(\[.*\])$/.exec(s);
     if(m&&this.acks.has(Number(m[1]))){this.acks.get(Number(m[1]))(JSON.parse(m[2])[0]);this.acks.delete(Number(m[1]));}
    }else if(s.startsWith('42')) {
     const args=JSON.parse(s.slice(2));
     for(const callback of this.handlers.get(args[0])||[])callback(args[1]);
    }
   });
   this.ws.on('error',reject);
  });
  await this.ready; return this;
 }
 send(event,payload={}){return new Promise((resolve,reject)=>{
  const id=this.next++,timer=setTimeout(()=>{this.acks.delete(id);reject(new Error('socket ack timeout '+event))},10000);
  this.acks.set(id,response=>{clearTimeout(timer);resolve(response);});
  this.ws.send('42'+id+JSON.stringify([event,payload]));
 });}
 on(event,fn){if(!this.handlers.has(event))this.handlers.set(event,[]);this.handlers.get(event).push(fn);}
 close(){if(this.ws)this.ws.close();}
}
(async()=>{
 const owner=await new Client('owner').connect();
 const member=await new Client('member').connect();
 try{
  check(await api(null,'/api/messages/search?scope=channel&scope_id='+q.channel+'&q=qa'),401,'Anonymous search blocked');
  check(await api('outsider','/api/messages/search?scope=channel&scope_id='+q.channel+'&q=qa'),403,'Outsider search blocked');
  check(await api('owner','/api/messages/search?scope=channel&scope_id='+q.channel+'&q=x'),400,'Short search rejected');
  assert.equal((await owner.send('channel:join',{channelId:q.channel})).ok,true);
  assert.equal((await member.send('channel:join',{channelId:q.channel})).ok,true);
  const first=await owner.send('message:send',{channelId:q.channel,content:'Primeira mensagem 🔥'});
  assert.equal(first.ok,true);const one=first.message.id;
  assert.equal(first.message.reply,null);
  const second=await member.send('message:send',{channelId:q.channel,content:'Resposta testada',replyTo:one});
  assert.equal(second.ok,true);const two=second.message.id;
  assert.equal(second.message.reply.id,one);
  console.log('PASS channel replies reference only existing messages');
  const deniedReply=await member.send('message:send',{channelId:q.otherChannel,content:'Fora de contexto',replyTo:one});
  assert(deniedReply.error?.includes('não encontrada'));console.log('PASS cross-channel reply rejected');
  let history=check(await api('owner','/api/servers/channels/'+q.channel+'/messages'),200,'Channel history');
  const reply=history.messages.find(m=>m.id===two);
  assert.equal(reply.reply.id,one);
  check(await api('member','/api/messages/channel/'+q.channel+'/'+one,json('PATCH',{content:'Alteração indevida'})),403,'Non-author edit denied');
  const updated=check(await api('owner','/api/messages/channel/'+q.channel+'/'+one,json('PATCH',{content:'Mensagem editada🔥'})),200,'Author edits own channel message');
  assert(updated.edited_at);
  check(await api('owner','/api/messages/channel/'+q.channel+'/'+one+'/react',json('POST',{emoji:'🔥'})),200,'First reaction');
  let reactions=check(await api('member','/api/messages/channel/'+q.channel+'/'+one+'/react',json('POST',{emoji:'🔥'})),200,'Second reaction');
  assert.equal(reactions.reactions.find(x=>x.emoji==='🔥').count,2);
  reactions=check(await api('member','/api/messages/channel/'+q.channel+'/'+one+'/react',json('POST',{emoji:'🔥'})),200,'Reaction toggled off');
  assert.equal(reactions.reactions.find(x=>x.emoji==='🔥').count,1);
  check(await api('owner','/api/messages/channel/'+q.channel+'/'+one+'/react',json('POST',{emoji:'<script>'})),400,'HTML reaction rejected');
  history=check(await api('owner','/api/servers/channels/'+q.channel+'/messages'),200,'Enriched history');
  assert.equal(history.messages.find(m=>m.id===one).content,'Mensagem editada🔥');
  assert.equal(history.messages.find(m=>m.id===one).reactions[0].count,1);
  assert.equal(history.messages.find(m=>m.id===one).edited_at!==null,true);
  let search=check(await api('owner','/api/messages/search?scope=channel&scope_id='+q.channel+'&q='+encodeURIComponent('editada')),200,'Search channel messages');
  assert.equal(search.messages.length,1);
  const escaped=check(await api('owner','/api/messages/search?scope=channel&scope_id='+q.channel+'&q='+encodeURIComponent('%_')),200,'Search literal percent underscore');
  assert.equal(escaped.messages.length,0);
  // Reply deletion must show safe fallback; moderator/owner can delete member content.
  check(await api('owner','/api/messages/channel/'+q.channel+'/'+two,{method:'DELETE'}),200,'Server owner deletes member message');
  check(await api('member','/api/messages/channel/'+q.channel+'/'+one,{method:'DELETE'}),403,'Member cannot delete owner message');
  const ownDelete=await owner.send('message:send',{channelId:q.channel,content:'Pode apagar'});assert(ownDelete.ok);
  check(await api('owner','/api/messages/channel/'+q.channel+'/'+ownDelete.message.id,{method:'DELETE'}),200,'Author can delete own message');
  // DM replies, edits and reactions must never leak to outsiders.
  const dm=await member.send('dm:send',{dmId:q.dm,content:'Oi no PV'});assert(dm.ok);
  const dmMessage=dm.message.id;
  const dmReply=await owner.send('dm:send',{dmId:q.dm,content:'Resposta PV',replyTo:dmMessage});assert(dmReply.ok&&dmReply.message.reply.id===dmMessage);
  check(await api('outsider','/api/messages/search?scope=dm&scope_id='+q.dm+'&q=Oi'),403,'Private DM search blocked');
  check(await api('outsider','/api/messages/dm/'+q.dm+'/'+dmMessage,json('PATCH',{content:'hack'})),403,'Private DM edit blocked');
  check(await api('owner','/api/messages/dm/'+q.dm+'/'+dmMessage,json('PATCH',{content:'hack'})),403,'DM recipient cannot edit sender');
  check(await api('member','/api/messages/dm/'+q.dm+'/'+dmMessage,json('PATCH',{content:'PV editado'})),200,'DM author can edit');
  check(await api('owner','/api/messages/dm/'+q.dm+'/'+dmMessage+'/react',json('POST',{emoji:'💜'})),200,'Private DM reaction');
  check(await api('outsider','/api/messages/dm/'+q.dm+'/'+dmMessage+'/react',json('POST',{emoji:'💜'})),403,'Outsider cannot react in private DM');
  const dmHistory=check(await api('owner','/api/dms/'+q.dm+'/messages'),200,'Enriched DM history');
  assert.equal(dmHistory.messages.find(x=>x.id===dmReply.message.id).reply.id,dmMessage);
  check(await api('owner','/api/messages/dm/'+q.dm+'/'+dmMessage,{method:'DELETE'}),403,'Recipient cannot delete sender DM');
  check(await api('member','/api/messages/dm/'+q.dm+'/'+dmMessage,{method:'DELETE'}),200,'DM author can delete');
  const postDelete=check(await api('owner','/api/dms/'+q.dm+'/messages'),200,'DM reply after original deleted');
  assert.equal(postDelete.messages.find(x=>x.id===dmReply.message.id).reply.author_name,'Mensagem excluída');
  console.log('ALL PHASE1 INTEGRATION TESTS PASS');
 }finally{owner.close();member.close();}
})().catch(err=>{console.error(err.stack||err);process.exitCode=1});
