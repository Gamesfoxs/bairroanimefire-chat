// Synthetic staging fixtures; run ONLY with DB_PATH ending /data/phase1-test.db.
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const jwt=require('jsonwebtoken');
const root=path.resolve(__dirname,'..');
const expected=path.join(root,'data','phase1-test.db');
if(process.env.DB_PATH!==expected)throw new Error('Refusing fixture creation outside isolated QA DB');
if(!process.env.JWT_SECRET || process.env.JWT_SECRET.length<40)throw new Error('QA JWT_SECRET missing');
(async()=>{
 const db=await require('../src/db').init();
 const u={};
 for(const name of ['owner','member','outsider']){
  const id=crypto.randomUUID();u[name]=id;
  db.run('INSERT INTO users(id,username,password_hash,display_name,avatar_color) VALUES(?,?,?,?,?)',
    [id,'qa_'+name+'_'+id.slice(0,6),'','QA '+name,'#7658ab']);
  fs.writeFileSync(path.join(root,'data','phase1-'+name+'.cookie'),
    'token='+jwt.sign({id,username:'qa_'+name},process.env.JWT_SECRET,{expiresIn:'1h'}),{mode:0o600});
 }
 u.guild=crypto.randomUUID();u.channel=crypto.randomUUID();u.dm=crypto.randomUUID();u.otherChannel=crypto.randomUUID();
 db.run('INSERT INTO servers(id,name,owner_id,icon_emoji) VALUES(?,?,?,?)',[u.guild,'QA Test Guild',u.owner,'🔥']);
 for(const kind of ['owner','member'])db.run('INSERT INTO server_members(server_id,user_id) VALUES(?,?)',[u.guild,u[kind]]);
 for(const channel of [u.channel,u.otherChannel])db.run('INSERT INTO channels(id,server_id,name,type) VALUES(?,?,?,?)',
  [channel,u.guild,'qa-'+channel.slice(0,4),'text']);
 const pair=[u.owner,u.member].sort();
 db.run('INSERT INTO dm_channels(id,user1_id,user2_id) VALUES(?,?,?)',[u.dm,...pair]);
 fs.writeFileSync(path.join(root,'data','phase1-fixtures.json'),JSON.stringify(u),{mode:0o600});
 console.log('PASS: synthetic staging fixtures generated');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
