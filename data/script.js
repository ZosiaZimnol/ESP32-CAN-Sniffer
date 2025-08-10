/*
  Copyright (c) 2025 Zofia Zimnol
  Wszelkie prawa zastrzeżone.
*/

// --- helpers ---
function arrToInputs(valArr, name, len=8) {
  return Array.from({length:len}, (_,i) =>
    `<input type="text" size="2" maxlength="2" value="${valArr && valArr[i]!==undefined?valArr[i].toString(16).padStart(2,"0"):"00"}" data-name="${name}" data-idx="${i}" style="width:2.5em;">`
  ).join(' ');
}
function getInputs(tr, name, len=8) {
  return Array.from(tr.querySelectorAll(`input[data-name="${name}"]`)).map(e=>parseInt(e.value,16)||0).slice(0,len);
}
function actionRow(a) {
  let html = `<div class="act-row">ID <input type="text" value="${a.id||""}" size="4" class="actid">
  ${arrToInputs(a.data,"actdata")}
  Len <input type="number" min="1" max="8" value="${a.len||8}" class="actlen" style="width:3em;">
  Repeat <input type="number" min="1" value="${a.repeat||1}" class="actrep" style="width:3em;">
  Gap(ms) <input type="number" min="0" value="${a.gap_ms||0}" class="actgap" style="width:4em;">
  Hold(ms) <input type="number" min="0" value="${a.hold_ms||0}" class="acthold" style="width:4em;">
  <button class="delAct">🗑</button>
  </div>`;
  return html;
}
function actionRowBlank() {
  return actionRow({id:"",data:Array(8).fill(0),len:8,repeat:1,gap_ms:0,hold_ms:0});
}
function getActions(div) {
  return Array.from(div.querySelectorAll(".act-row")).map(row=>{
    return {
      id: row.querySelector(".actid").value,
      data: Array.from(row.querySelectorAll('input[data-name="actdata"]')).map(e=>parseInt(e.value,16)||0),
      len: parseInt(row.querySelector(".actlen").value)||8,
      repeat: parseInt(row.querySelector(".actrep").value)||1,
      gap_ms: parseInt(row.querySelector(".actgap").value)||0,
      hold_ms: parseInt(row.querySelector(".acthold").value)||0
    };
  });
}

// --- NAV ---
document.querySelectorAll('.tab').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('.pane').forEach(p => p.hidden = true);
    const target = document.getElementById(b.dataset.tab);
    target.hidden = false;

    if (b.dataset.tab === 'txPane') {
      const txLenInput = document.getElementById("txLen");
      const txInputsDiv = document.getElementById("txDataInputs");
      const sendTxBtn = document.getElementById("sendTx");

      buildTxInputs(parseInt(txLenInput?.value || 8));

      if (txLenInput) {
        txLenInput.oninput = e => buildTxInputs(parseInt(e.target.value) || 8);
      }

      if (sendTxBtn) {
        sendTxBtn.onclick = () => {
          const id = document.getElementById("txId").value.trim();
          const len = parseInt(txLenInput.value) || 8;
          const repeat = parseInt(document.getElementById("txRep").value) || 1;
          const data = Array.from(txInputsDiv.querySelectorAll("input")).map(e => {
            const val = parseInt(e.value, 16);
            return isNaN(val) ? "00" : val.toString(16).padStart(2, "0");
          }).join(" ");

          fetch("/tx", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, len, repeat, data })
          })
          .then(r => r.text())
          .then(() => document.getElementById("txMsg").textContent = "✔️ Wysłano")
          .catch(() => document.getElementById("txMsg").textContent = "❌ Błąd");
        };
      }
    }
  };
});

// --- Notes (backend + fallback) ---
const notesArea = document.getElementById('notesArea');
const notesMsg  = document.getElementById('notesMsg');

if (notesArea) {
  fetch('/notes')
    .then(r => r.ok ? r.text() : '')
    .then(txt => notesArea.value = txt)
    .catch(() => notesArea.value = localStorage.getItem('userNotes') || '');
}

document.getElementById('saveNotes').onclick = () => {
  const txt = notesArea.value;
  fetch('/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: txt
  })
  .then(r => {
    if (r.ok) {
      notesMsg.textContent = '✔️ Zapisano (na serwerze)';
      localStorage.setItem('userNotes', txt); // backup
    } else {
      notesMsg.textContent = '❌ Nie udało się zapisać';
    }
    setTimeout(() => notesMsg.textContent = '', 2500);
  })
  .catch(() => {
    notesMsg.textContent = '⚠️ Zapisano lokalnie';
    localStorage.setItem('userNotes', txt);
    setTimeout(() => notesMsg.textContent = '', 2500);
  });
};


// --- DB ---
const customDB = JSON.parse(localStorage.getItem('customDB')||'{}'); // user entries first
let db = {};
fetch('vag_db.json').then(r=>r.json()).then(std=>{
  db = {...std, ...customDB}; buildDB();
});

// --- Rules ---
const url='/cfg';
let cfg={};
const tb=document.querySelector('#tbl tbody'), msg=document.getElementById('msg');
safeFetch(url,{rules:[]}).then(j=>{
  cfg = j;
  if (!cfg || !cfg.rules) cfg = { rules: [] };  
  render();
});

function render() {
  tb.innerHTML='';
  cfg.rules.forEach((r,i)=>{
    const tr=document.createElement('tr');
    let trigger = r.trigger||{};
    let actDiv = document.createElement("div");
    let actArr = r.action && r.action.sequence ? r.action.sequence : [];
    actDiv.innerHTML = actArr.map(a=>actionRow(a)).join('') + `<button class="addAct">+ Akcja</button>`;
    actDiv.className = "act-wrap";
    tr.innerHTML=`
      <td>${i}</td>
      <td><input value="${trigger.id||""}" size="4" class="trigid"></td>
      <td colspan="8">${arrToInputs(trigger.data,"trigdata")}</td>
      <td colspan="8">${arrToInputs(trigger.mask,"trigmask")}</td>
      <td><input type="number" value="${trigger.count||1}" class="trigcount" min="1" style="width:3em"></td>
      <td><input type="number" value="${trigger.window_ms||500}" class="trigwin" min="1" style="width:4em"></td>
      <td></td>
      <td></td>
    `;
    let td=document.createElement("td"); td.appendChild(actDiv); tr.appendChild(td);

    let delTd=document.createElement("td");
    delTd.innerHTML = `<button onclick="del(${i})">🗑</button>`;
    tr.appendChild(delTd);

    tb.appendChild(tr);

    // Obsługa akcji w każdej regule
    actDiv.querySelectorAll(".delAct").forEach(b=>{
      b.onclick = ()=>{ b.parentElement.remove(); }
    });
    actDiv.querySelector(".addAct").onclick = ()=>{
      actDiv.insertBefore(document.createRange().createContextualFragment(actionRowBlank()), actDiv.querySelector(".addAct"));
      actDiv.querySelectorAll(".delAct").forEach(b=>{
        b.onclick = ()=>{ b.parentElement.remove(); }
      });
    };
  });
}
function del(i){ cfg.rules.splice(i,1); render(); }
document.getElementById('add').onclick=()=>{
  cfg.rules.push({
    trigger:{id:"0x000",data:Array(8).fill(0),mask:Array(8).fill(0),count:1,window_ms:500},
    action:{sequence:[]}
  }); render();
};
document.getElementById('save').onclick=()=>{
  cfg.rules=[...tb.children].map(tr=>{
    return {
      trigger:{
        id: tr.querySelector('.trigid').value,
        data: getInputs(tr,"trigdata"),
        mask: getInputs(tr,"trigmask"),
        count: parseInt(tr.querySelector(".trigcount").value)||1,
        window_ms: parseInt(tr.querySelector(".trigwin").value)||500
      },
      action:{
        sequence: getActions(tr.querySelector(".act-wrap"))
      }
    }
  });
  fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)})
    .then(r=>r.text()).then(()=>msg.textContent='Zapisano!');
};

// --- Sniffer ---
const log=document.getElementById('log'), fid=document.getElementById('fid');
const autoscrollChk = document.getElementById('autoscroll');
function desc(id){ return db['0x'+id.toString(16).toUpperCase()]||''; }
const sniffStopBtn = document.getElementById('sniffStop');
const sniffStartBtn = document.getElementById('sniffStart');
let sniffRunning = true;
const ws = safeWS(`ws://${location.host}/sniff`, e => {
  const f = JSON.parse(e.data);
  if (!sniffRunning) return;

  const flt = fid.value.trim();
  if (flt && f.id.toString(16) !== flt.toLowerCase()) return;

  const line = `${f.ts.toString().padStart(7)}  0x${f.id.toString(16)}  ${f.data}${desc(f.id) ? ' // ' + desc(f.id) : ''}\n`;

  const isTA = log.tagName === 'TEXTAREA';
  const atBottom = Math.abs(log.scrollHeight - log.scrollTop - log.clientHeight) < 4;

  if (isTA) {
    log.value += line;
  } else {
    log.textContent += line;
  }

  if (atBottom && autoscrollChk?.checked) {
    requestAnimationFrame(() => {
      if (isTA) {
        const len = log.value.length;
        log.setSelectionRange(len, len);
      }
      log.scrollTop = log.scrollHeight;
    });
  }
});

document.getElementById('clr').onclick = () => {
  if (log.tagName === 'TEXTAREA') log.value = '';
  else log.textContent = '';
};

sniffStopBtn.onclick = async () => {
  await fetch('/sniff/stop', { method: 'POST' });  
  sniffRunning = false;                              
  sniffStopBtn.disabled = true;
  sniffStartBtn.disabled = false;
};
sniffStartBtn.onclick = async () => {
  await fetch('/sniff/start', { method: 'POST' });  
  sniffRunning = true;
  sniffStopBtn.disabled = false;
  sniffStartBtn.disabled = true;
};

// --- DB ---
const q=document.getElementById('q'), tbodyDB=document.querySelector('#tblDB tbody');
function buildDB(filter=''){
  tbodyDB.innerHTML='';
  Object.entries(db)
    .filter(([id,text])=>id.includes(filter)||text.toLowerCase().includes(filter.toLowerCase()))
    .forEach(([id,text])=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${id}</td><td>${text}</td>`;
      tbodyDB.appendChild(tr);
    });
}
q.oninput=()=>buildDB(q.value);

// --- Add custom DB entry ---
if(document.getElementById('addCustom')){
  const newId=document.getElementById('newId'), newDesc=document.getElementById('newDesc'), dbMsg=document.getElementById('dbMsg');
  document.getElementById('addCustom').onclick=()=>{
    const id = newId.value.trim().toUpperCase();
    const desc = newDesc.value.trim();
    if(!/^0x[0-9A-F]+$/.test(id)){ dbMsg.textContent='Podaj ID w formacie 0x123'; return;}
    if(!desc){ dbMsg.textContent='Podaj opis'; return;}
    const saved = JSON.parse(localStorage.getItem('customDB')||'{}');
    saved[id] = desc;
    localStorage.setItem('customDB', JSON.stringify(saved));
    db[id] = desc;           // override std
    buildDB(q.value);        // refresh table
    dbMsg.textContent='✔️ Zapisano do bazy (lokalnie w przeglądarce)';
    setTimeout(()=>dbMsg.textContent='',2500);
    newId.value=''; newDesc.value='';
  };
}

// --- Safe utilities ---
async function safeFetch(url, def){
  try{ const r = await fetch(url); if(r.ok) return r.json(); }
  catch(e){ console.warn('fetch fail', e); }
  return def;
}
function safeWS(url, onmsg){
  let ws;
  try{ ws = new WebSocket(url); }
  catch(e){ console.warn('WS init fail', e); }
  if(ws){
    ws.onmessage = onmsg;
    ws.onerror   = e=>console.warn('WS err', e);
    ws.onclose   = ()=>console.warn('WS closed');
    return ws;
  }
  setInterval(()=>{
    const f={
      ts: Date.now()&0xFFFFFF,
      id: 0x158 + (Math.random()*12|0)*0x10,
      data: Array.from({length:8},_=>('0'+(Math.random()*256|0).toString(16)).slice(-2)).join(' ')
    };
    onmsg({data: JSON.stringify(f)});
  },200);
  return null;
}
