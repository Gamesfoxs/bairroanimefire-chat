// Node built-in browser-independent regression checks for the responsive chat.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'..');
const src = fs.readFileSync(path.join(root,'public/js/app.js'),'utf8');
const html = fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const css = fs.readFileSync(path.join(root,'public/css/style.css'),'utf8');
const sw = fs.readFileSync(path.join(root,'public/sw.js'),'utf8');

function extract(start,end) {
  const a=src.indexOf(start);
  const b=src.indexOf(end,a+start.length);
  assert(a>=0 && b>a,'Cannot extract '+start);
  return src.slice(a,b);
}
async function run() {
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size, ids.length,'Duplicate HTML IDs');
  for (const [,id] of src.matchAll(/\$\('#([\w-]+)'\)/g)) {
    assert(ids.includes(id),'Missing element #'+id);
  }
  assert(css.includes('[hidden] { display: none !important; }'));
  assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
  for (const id of ['voice-quality','attachment-thumb','attachment-state',
    'upload-progress','media-lightbox','media-lightbox-close']) assert(ids.includes(id));
  assert(html.includes('20261114v8') && sw.includes('20261114v8'));
  console.log('PASS UI markup + CSS and version selectors');

  const env={ mobile:true,saveData:false };
  const select={value:'auto',addEventListener(){}};
  const hint={textContent:''};
  const state={videoQuality:'auto',videoMode:null,videoStream:null,voicePeers:new Map()};
  const context=vm.createContext({
    state,navigator:{connection:{get saveData(){return env.saveData;}}},
    window:{matchMedia(){return {matches:env.mobile}},addEventListener(){}},
    localStorage:{setItem(){}},toast(){},console,
    $:selector=>selector==='#voice-quality'?select:hint,
  });
  const source=extract('  const videoPresets = {','  function createVoicePeer(');
  const quality=vm.runInContext(source+';({currentVideoPreset,applyPeerVideoQuality})',context);
  assert.equal(quality.currentVideoPreset().height,540,'Default phone 540p');
  env.mobile=false;
  assert.equal(quality.currentVideoPreset().height,720,'Default PC 720p');
  env.saveData=true;
  assert.equal(quality.currentVideoPreset().height,360,'Data saver 360p');
  state.videoQuality='high';
  assert.equal(quality.currentVideoPreset().height,720,'HD explicit');
  state.videoQuality='balanced'; state.videoMode='camera';
  let sent;
  await quality.applyPeerVideoQuality({_videoSender:{
    getParameters(){return {encodings:[{}]}},
    async setParameters(value){sent=value}
  }});
  assert.equal(sent.encodings[0].maxBitrate,850000);
  console.log('PASS mobile / desktop / data saver video profiles and WebRTC bitrate');

  const hstate={view:'channel',activeChannelId:'a',activeDmId:null,
    historyRequestId:0,loadingHistoryKey:null,bufferedHistoryMessages:[]};
  const deferred=[];const rendered=[];const errors=[];
  const hx=vm.createContext({state:hstate,api:() => new Promise(resolve=>deferred.push(resolve)),
    renderMessages:(items,scroll)=>rendered.push({items,scroll}),toast:msg=>errors.push(msg)});
  const history=vm.runInContext(extract('  async function refreshCurrentHistory','  function renderMessages(')+';refreshCurrentHistory',hx);
  const first=history();
  hstate.activeChannelId='b';
  const second=history();
  deferred[1]({messages:[{id:'second',created_at:'2026-11-14 19:00:00'}]});
  await second;
  deferred[0]({messages:[{id:'first',created_at:'2026-11-14 18:00:00'}]});
  await first;
  assert.equal(rendered.length,1);
  assert.equal(rendered[0].items[0].id,'second','Old channel response must not overwrite current');
  const third=history();
  hstate.bufferedHistoryMessages.push({id:'new',created_at:'2026-11-14 20:00:00'});
  hstate.bufferedHistoryMessages.push({id:'old',created_at:'2026-11-14 19:00:00'});
  deferred[2]({messages:[{id:'old',created_at:'2026-11-14 19:00:00'}]});
  await third;
  assert.equal(rendered.length,2);
  assert.deepEqual(rendered[1].items.map(x=>x.id).join(','),'old,new');
  assert.equal(errors.length,0);
  console.log('PASS racing navigation, reconnect history and live message de-duplication');

  assert(src.includes('new XMLHttpRequest()'));
  assert(src.includes('xhr.upload.addEventListener'));
  assert(src.includes('URL.revokeObjectURL'));
  assert(src.includes('event.clipboardData'));
  assert(src.includes('closeMediaLightbox'));
  console.log('PASS media preview / upload progress / paste and viewer hooks');
}
run().catch(err=>{console.error(err);process.exit(1)});
