// Run against an isolated instance with only synthetic fixture users.
const fs=require('fs');
const assert=require('node:assert/strict');
const WebSocket=require('ws');
const root=require('path').join(__dirname,'..');
const ids=JSON.parse(fs.readFileSync(root+'/data/qa-ids.json'));
const cookie=role=>fs.readFileSync(root+'/data/qa-'+role+'.cookie','utf8');
const base='http://127.0.0.1:3035';

async function request(role,path,options={}) {
  const response=await fetch(base+path,{
    ...options,redirect:'manual',headers:{...(options.headers||{}),...(role?{Cookie:cookie(role)}:{})}
  });
  return {status:response.status,headers:response.headers,body:await response.json().catch(()=>({}))};
}
function status(res,code,label) {
  assert.equal(res.status,code,label+': '+JSON.stringify(res.body));
  console.log('PASS',label,code);
  return res.body;
}
async function sendSyntheticDm(count) {
  return new Promise((resolve,reject) => {
    const socket=new WebSocket('ws://127.0.0.1:3035/socket.io/?EIO=4&transport=websocket',{
      headers:{Cookie:cookie('peer'),Origin:'https://chat.bairroanimefire.com'}
    });
    let received=0;
    const timer=setTimeout(()=>{socket.close();reject(new Error('DM event timeout'))},12000);
    socket.on('message',raw => {
      const msg=raw.toString();
      if (msg.startsWith('0')) socket.send('40');
      else if (msg.startsWith('40')) {
        for(let i=1;i<=count;i++){
          socket.send('42'+i+JSON.stringify(['dm:send',{dmId:ids.dm,content:'Synthetic unread test '+i}]));
        }
      } else if (msg==='2') socket.send('3');
      else if (msg.startsWith('43')) {
        const match=/^43(\d+)(\[.*\])$/.exec(msg);
        if(!match) return;
        const ack=JSON.parse(match[2])[0];
        if(!ack.ok) { clearTimeout(timer);socket.close();return reject(new Error(JSON.stringify(ack))); }
        received++;
        if(received===count) { clearTimeout(timer);socket.close();resolve(); }
      }
    });
    socket.on('error',reject);
  });
}
async function messageRateTest() {
  return new Promise((resolve,reject) => {
    const socket=new WebSocket('ws://127.0.0.1:3035/socket.io/?EIO=4&transport=websocket',{
      headers:{Cookie:cookie('owner'),Origin:'https://chat.bairroanimefire.com'}
    });
    const result={successes:0,limits:0,responses:0};
    const timer=setTimeout(()=>{socket.close();reject(new Error('socket timeout '+JSON.stringify(result)))},18000);
    socket.on('message',raw => {
      const str=raw.toString();
      if (str.startsWith('0')) socket.send('40');
      else if (str.startsWith('40')) {
        for(let i=1;i<=20;i++) {
          socket.send('42'+i+JSON.stringify(['message:send',{channelId:ids.channel,content:'Synthetic message '+i}]));
        }
      } else if(str==='2') socket.send('3');
      else if(str.startsWith('43')) {
        const match=/^43(\d+)(\[.*\])$/.exec(str);
        if(!match) return;
        const ack=JSON.parse(match[2])[0];
        result.responses++;
        if (ack.ok) result.successes++;
        if (String(ack.error||'').includes('Muitas mensagens')) result.limits++;
        if(result.responses===20) {
          clearTimeout(timer);socket.close();
          try {
            assert.equal(result.successes,16);
            assert.equal(result.limits,4);
            console.log('PASS per-user websocket spam guard, 16 allowed, 4 blocked');
            resolve();
          } catch(err) { reject(err); }
        }
      }
    });
    socket.on('error',reject);
  });
}
async function main(){
  const view=await request(null,'/');
  status(view,200,'homepage');
  const policy=view.headers.get('content-security-policy')||'';
  assert(policy.includes("script-src 'self'"));
  assert(policy.includes("frame-ancestors 'none'"));
  assert(!policy.includes("unsafe-eval"));
  assert(!policy.includes("script-src 'self' 'unsafe-inline'"));
  assert.equal(view.headers.get('x-frame-options'),'DENY');
  assert(view.headers.get('permissions-policy')?.includes('microphone=(self)'));
  console.log('PASS CSP, X-Frame-Options, browser permission rules');
  status(await request(null,'/api/dms'),401,'anonymous cannot read inbox');
  const dm=ids.dm;
  let owner=status(await request('owner','/api/dms'),200,'owner inbox');
  let peer=status(await request('peer','/api/dms'),200,'peer inbox');
  const initialOwner=owner.channels.find(x=>x.id===dm).unread_count;
  const initialPeer=peer.channels.find(x=>x.id===dm).unread_count;
  await sendSyntheticDm(2);
  owner=status(await request('owner','/api/dms'),200,'owner inbox receives 2 test messages');
  peer=status(await request('peer','/api/dms'),200,'peer inbox unchanged for own messages');
  assert.equal(owner.channels.find(x=>x.id===dm).unread_count,initialOwner+2);
  assert.equal(peer.channels.find(x=>x.id===dm).unread_count,initialPeer);
  console.log('PASS real-time DM messages update only recipient unread');
  status(await request('outsider','/api/dms/'+dm+'/read',{method:'POST'}),403,'outsider cannot mark read');
  status(await request('owner','/api/dms/'+dm+'/read',{method:'POST'}),200,'owner marks DM read');
  owner=status(await request('owner','/api/dms'),200,'owner inbox after read');
  peer=status(await request('peer','/api/dms'),200,'peer inbox remains unread');
  assert.equal(owner.channels.find(x=>x.id===dm).unread_count,0);
  assert.equal(peer.channels.find(x=>x.id===dm).unread_count,initialPeer);
  console.log('PASS read state persists per individual account');
  const cross=await fetch(base+'/api/health',{headers:{Origin:'https://untrusted.invalid'}});
  assert.equal(cross.status,403);
  console.log('PASS unauthorized Origin rejected');
  await messageRateTest();
  console.log('PASS professional integration suite complete');
}
main().catch(err=>{console.error(err.stack||err);process.exit(1)});
