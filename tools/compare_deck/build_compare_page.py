#!/usr/bin/env python3
"""Portable builder for the house compare/review page (the a6-review framework).

Extracted 2026-08-24 from docs/a6-review/spider/index.html (ComfyUI-MAINodes)
so any project can emit one: card grid with hover-play + audio-on-click,
sortable metric table with inline bars, head-to-head A/B (side-by-side AND
wipe) with drift-glide sync, starred picks exported as markdown, keyboard
(space, f, 1/2). Data-driven: a manifest JSON in, one self-contained HTML out
(videos/posters stay external by per-row path or a media base URL).

  python3 build_compare_page.py manifest.json out.html

Manifest: {title, h1, lede_html, aspect: "W/H", media: "" (optional base),
 cols: [[key,label,decimals,sortdir], ...], groups: [...],
 rows: [{arm, group, desc, src, poster, curve?, ref_curve?, <metric keys>}]}
Rows may omit src/poster if `media` is set (then MEDIA/<arm>.mp4/.jpg).
"""
import json, os, sys, html

def build(m):
    cols = m["cols"]
    rows = m["rows"]
    groups = m.get("groups") or sorted({r["group"] for r in rows})
    aspect = m.get("aspect", "16/9")
    media = m.get("media", "")
    grp_opts = '<option value="">all</option>' + "".join(f"<option>{g}</option>" for g in groups)
    return TEMPLATE.replace("__TITLE__", html.escape(m["title"])) \
        .replace("__H1__", m.get("h1", html.escape(m["title"]))) \
        .replace("__LEDE__", m.get("lede_html", "")) \
        .replace("__ASPECT__", aspect) \
        .replace("__GROUPS__", grp_opts) \
        .replace("__MEDIA__", json.dumps(media)) \
        .replace("__COLS__", json.dumps(cols)) \
        .replace("__ROWS__", json.dumps(rows)) \
        .replace("__FPS__", str(m.get("fps", 24))) \
        .replace("__MUXJS__", _muxjs())

VENDOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor")
MUXERS = ("mp4-muxer.min.js", "webm-muxer.min.js")

def _muxjs():
    """Inline the two muxers the frame-exact export needs.

    Resolved next to THIS file, never against the cwd, so the builder works
    from any working directory. A missing muxer raises instead of shrugging:
    the page would still build and still export, but it would drop silently
    to the real-time MediaRecorder path, and that shows up much later as a
    soft, wrong-length capture. See vendor/NOTICE for what these are.
    """
    out = []
    for f in MUXERS:
        fp = os.path.join(VENDOR, f)
        if not os.path.exists(fp):
            raise FileNotFoundError(
                "missing vendored muxer %s (looked in %s); the frame-exact "
                "export needs both of %s" % (f, VENDOR, ", ".join(MUXERS)))
        with open(fp, encoding="utf-8") as fh:
            out.append(fh.read())
    return "\n".join(out)

TEMPLATE = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>__TITLE__</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#0f1115;--bg2:#171a1f;--bg3:#1f232a;--grid:#2b2f36;--ink:#e8eaed;--dim:#9aa3ad;--mute:#6f7b8a;--ref:#3fa66a;--sat:#3f93d6;--pick:#f2c94c;--bar:#3f93d6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,Segoe UI,Roboto,sans-serif}
a{color:#8ab4f8}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:18px 0 8px;color:var(--dim);font-weight:600;letter-spacing:.02em;text-transform:uppercase}
header{padding:16px 20px 10px;border-bottom:1px solid var(--grid)}
.lede{color:var(--dim);max-width:1100px;margin:4px 0 0}.lede b{color:var(--ink)}
main{padding:0 20px 60px}
.bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:10px 0;position:sticky;top:0;background:var(--bg);z-index:5;border-bottom:1px solid var(--grid)}
select,button,input[type=range]{background:var(--bg3);color:var(--ink);border:1px solid var(--grid);border-radius:6px;padding:5px 9px;font:inherit}
button{cursor:pointer}button:hover{border-color:var(--dim)}button.on{border-color:var(--pick);color:var(--pick)}
.chip{display:inline-block;padding:1px 7px;border-radius:10px;font-size:11px;border:1px solid var(--grid);color:var(--dim)}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;font-size:13px}
th,td{padding:4px 8px;border-bottom:1px solid var(--grid);text-align:right;white-space:nowrap}
th{color:var(--dim);font-weight:600;cursor:pointer;position:sticky;top:var(--thtop,52px);background:var(--bg);user-select:none;box-shadow:0 1px 0 var(--grid)}
th.s{color:var(--ink)}td:first-child,th:first-child,td:nth-child(2),th:nth-child(2){text-align:left}
tr:hover td{background:var(--bg2)}tr.sel td:first-child{box-shadow:inset 3px 0 var(--pick)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(400px,1fr));gap:14px}
.card{background:var(--bg2);border:1px solid var(--grid);border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
.card.sel{border-color:var(--pick)}.card.hid{display:none}
.card video{width:100%;aspect-ratio:__ASPECT__;background:#000;display:block;cursor:pointer}
.ch{display:flex;align-items:center;gap:8px;padding:8px 10px 4px}.ch .nm{font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis}
.desc{color:var(--dim);font-size:12px;padding:0 10px 6px}
.mets{display:grid;grid-template-columns:repeat(4,1fr);gap:4px 10px;padding:4px 10px 8px;font-size:12px;font-variant-numeric:tabular-nums}
.mets div{display:flex;justify-content:space-between;gap:6px}.mets span{color:var(--mute)}
.spark{padding:0 10px 8px}.spark svg{width:100%;height:36px;display:block}
#h2h{background:var(--bg2);border:1px solid var(--grid);border-radius:10px;padding:12px;margin:12px 0}
#h2h .pane{display:grid;grid-template-columns:1fr 1fr;gap:10px;position:relative}
#ovl{position:absolute;top:8px;right:10px;z-index:6;display:flex;gap:8px;align-items:center;font:15px ui-monospace,monospace;color:#fff;text-shadow:0 1px 4px #000;pointer-events:none}
#blip{display:inline-block;width:16px;height:16px;border-radius:50%;opacity:0;transition:opacity .12s;box-shadow:0 0 8px 2px rgba(0,0,0,.5)}
#h2h .pane.wipe{display:block;position:relative;aspect-ratio:__ASPECT__;background:#000}
#h2h .pane.wipe>div{position:absolute;inset:0}
#h2h .pane.wipe .lbl{display:none}
#h2h .pane.wipe video{width:100%;height:100%;object-fit:contain}
#h2h .pane.wipe>div:nth-of-type(2){clip-path:inset(0 0 0 var(--w,50%))}
#h2h .pane.wipe::after{content:"";position:absolute;top:0;bottom:0;left:var(--w,50%);width:2px;background:var(--pick);pointer-events:none;z-index:2}
#h2h video{width:100%;aspect-ratio:__ASPECT__;background:#000;display:block}
#h2h .lbl{font-size:12px;color:var(--dim);margin:4px 0;display:flex;align-items:center;gap:6px}#h2h .lbl b{color:var(--ink)}
.kbd{font:12px ui-monospace,monospace;background:var(--bg3);border:1px solid var(--grid);border-radius:4px;padding:0 4px}
#pane:fullscreen{background:#000;align-items:center;padding:1vh 1vw;box-sizing:border-box}
#pane:fullscreen video{max-height:86vh;object-fit:contain}
.h2hbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
.h2hbar .gap{flex:0 0 8px;border-left:1px solid var(--grid);height:22px}
.abname{border:1px solid var(--grid);border-radius:8px;padding:3px 10px;background:var(--bg3)}
.abname.a{box-shadow:inset 3px 0 var(--pick)}.abname.b{box-shadow:inset 3px 0 var(--sat)}
button.big{font-size:15px;padding:5px 16px}
.seg{display:inline-flex;border:1px solid var(--grid);border-radius:8px;overflow:hidden}
.seg button{border:none;border-radius:0;background:var(--bg3);padding:5px 10px}
.seg button.on{background:var(--pick);color:#14161a;font-weight:600}
video.audioon{box-shadow:0 0 0 3px var(--pick)}
#picks{width:100%;min-height:80px;background:var(--bg3);color:var(--ink);border:1px solid var(--grid);border-radius:6px;font:12px ui-monospace,monospace;padding:8px}
.small{font-size:12px;color:var(--dim)}
#tl{background:var(--bg3);border:1px solid var(--grid);border-radius:6px;overflow:hidden}
</style></head><body>
<header><h1>__H1__</h1><p class="lede">__LEDE__</p></header>
<main>
<div class="bar">
 <label>sort <select id="sort"></select></label>
 <label>group <select id="grp">__GROUPS__</select></label>
 <button id="hoverplay" class="on">hover-play</button>
 <button id="onlysel">starred only</button>
 <span class="small" id="count"></span>
</div>
<h2>Head to head</h2>
<div id="h2h">
 <div class="h2hbar">
  <span class="abname a">A <b id="aname">-</b></span>
  <button id="flip" title="swap A and B (f)">&#8644;</button>
  <span class="abname b">B <b id="bname">-</b></span>
  <span class="gap"></span>
  <button id="play" class="big" title="play / pause (space)">&#9654;</button>
  <button id="restart" title="both from the top">&#8634;</button>
  <span class="seg" id="hearseg" title="which side you hear (1 / 2)"><button data-h="a">&#128266; A</button><button data-h="b">&#128266; B</button><button data-h="none">muted</button></span>
  <button id="mode" title="side by side or wipe">&#9707; wipe</button>
  <label id="wipelab" style="display:none">wipe <input type="range" id="wipe" min="0" max="100" value="50"></label>
  <button id="fsPane" title="both players fullscreen">&#9974; fullscreen A/B</button>
  <button id="gear" title="player settings">&#9881;</button>
  <select id="hear" style="display:none"><option value="a">a</option><option value="b">b</option><option value="none">none</option></select>
 </div>
 <div id="setpanel" style="display:none;background:var(--bg3);border:1px solid var(--grid);border-radius:8px;padding:10px;margin-bottom:10px;font-size:13px">
  <label>region frames <input id="spanA" type="number" style="width:74px"> &#8211; <input id="spanB" type="number" style="width:74px"></label>
  <button id="spanReset">reset to row</button>
  <label style="margin-left:14px"><input type="checkbox" id="setFc"> frame counter</label>
  <label style="margin-left:10px"><input type="checkbox" id="setBlip" checked> region enter/exit blips</label>
  <div style="margin-top:6px"><label>marks (frames, comma-sep) <input id="marks" type="text" style="width:280px" placeholder="e.g. 24, 60, 118"></label>
  <label style="margin-left:10px"><input type="checkbox" id="setMarkBlip" checked> mark blips</label></div>
 </div>
 <div class="pane" id="pane"><div id="ovl"><span id="blip"></span><span id="fcv" style="display:none">frame 0</span></div>
  <div><div class="lbl">A <b id="al"></b></div><video id="va" loop playsinline></video></div>
  <div><div class="lbl">B <b id="bl"></b></div><video id="vb" loop playsinline></video></div>
 </div>
 <div class="h2hbar" style="margin-top:8px">
  <div id="tl" style="flex:1;min-width:260px;height:84px"><canvas id="tlc" style="width:100%;height:100%;display:block;cursor:crosshair"></canvas></div>
  <span class="small" id="tnum" style="min-width:170px;font-variant-numeric:tabular-nums">0.00 s &#183; frame 0</span>
  <button id="lin" title="set loop start at the playhead (i)">&#8970; in</button>
  <button id="lout" title="set loop end at the playhead (o)">out &#8971;</button>
  <button id="lclear" title="reset brackets to the full clip">&#8634; full</button>
  <button id="export" title="export the current A/B view for the loop section">&#11123; export</button>
 </div>
 <div class="small" id="h2hm" style="margin-top:8px"></div>
</div>
<h2>Table (click a header to sort; click a row to scroll to its card)</h2>
<div style="overflow-x:auto"><table id="tbl"><thead></thead><tbody></tbody></table></div>
<h2>Clips</h2>
<div class="grid" id="grid"></div>
<h2>Picks</h2>
<p class="small">Starred arms with their numbers, as markdown; copy this back into the session.</p>
<textarea id="picks" readonly></textarea>
<div style="margin-top:6px"><button id="copy">copy</button> <button id="clear">clear stars</button></div>
<div id="xdlg" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:50">
 <div style="max-width:480px;margin:8vh auto;background:var(--bg2);border:1px solid var(--grid);border-radius:10px;padding:16px">
  <h2 style="margin-top:0">Export the current view</h2>
  <p class="small" id="xinfo"></p>
  <table style="font-size:13px"><thead><tr><th style="text-align:left">field</th><th>top overlay</th><th>end card</th></tr></thead><tbody id="xfields"></tbody></table>
  <label class="small" style="display:block;margin-top:8px"><input type="checkbox" id="xaudio" checked> include audio (the side you hear)</label>
  <label class="small" style="display:block;margin-top:4px"><input type="checkbox" id="xprecise" checked> precise export (WebCodecs: frame-exact, faster than real time)</label>
  <label class="small" style="display:block;margin-top:4px">codec <select id="xcodec"><option value="vp9" selected>best quality (VP9, .webm)</option><option value="av1">smallest (AV1, .webm, slow)</option><option value="mp4">compatibility (H.264 .mp4 - browsers ship a weak call-grade encoder)</option></select>
  &nbsp; bitrate <select id="xrate"><option value="24">24 Mbps</option><option value="16">16</option><option value="40">40</option><option value="60">60</option><option value="100">100</option></select></label>
  <div style="margin-top:10px;display:flex;gap:8px"><button id="xgo" class="big">record &amp; save</button><button id="xcancel">cancel</button><span class="small" id="xstat"></span></div>
 </div>
</div>
</main>
<script>__MUXJS__</script>
<script>
const ROWS = __ROWS__;
const MEDIA = __MEDIA__;
const COLS = __COLS__;
const REF = ROWS[0].arm;
const rowOf=a=>ROWS.find(r=>r.arm==a);
const srcRow=r=>r.src||`${MEDIA}/${r.arm}.mp4`;
const posterRow=r=>r.poster||(MEDIA?`${MEDIA}/${r.arm}.jpg`:"");
// no poster and no media base: omit the attribute entirely, or every card
// requests "/<arm>.jpg" and shows a 404 black tile
const posterAttr=r=>{const p=posterRow(r);return p?` poster="${p}"`:"";};
const fmtv=(k,v)=>v==null?"":(typeof v=="string"?v:v.toFixed(COLS.find(c=>c[0]==k)[2]));
const colorOf=r=>r.group=="control"||r.group=="reference"?"var(--ref)":r.color||"var(--sat)";
const LS="cmp."+document.title;let picks=new Set(JSON.parse(localStorage.getItem(LS)||"[]"));
const save=()=>{localStorage.setItem(LS,JSON.stringify([...picks]));renderPicks();};
let sortKey=COLS[0][0],sortDir=1,hover=true,onlySel=false,A=null,B=REF;
const rng=k=>{const v=ROWS.map(r=>r[k]).filter(x=>typeof x=="number");return [Math.min(...v),Math.max(...v)];};
const RNG={};COLS.forEach(c=>RNG[c[0]]=rng(c[0]));
function barw(k,v){const [lo,hi]=RNG[k];if(typeof v!="number"||hi==lo)return 0;return 8+62*(v-lo)/(hi-lo);}
function barbg(k,v){const w=barw(k,v);return w?` style="background:linear-gradient(90deg,rgba(63,147,214,.28) ${w.toFixed(0)}%,transparent ${w.toFixed(0)}%)"`:"";}
const $=s=>document.querySelector(s);
const sortSel=$("#sort");COLS.forEach(c=>{const o=document.createElement("option");o.value=c[0];o.textContent=c[1];sortSel.append(o)});
sortSel.value=sortKey;sortSel.onchange=()=>{sortKey=sortSel.value;sortDir=1;render();};
function visible(r){const g=$("#grp").value;if(g&&r.group!=g)return false;if(onlySel&&!picks.has(r.arm))return false;return true;}
function sorted(){return ROWS.slice().sort((x,y)=>{if(x.arm==REF)return -1;if(y.arm==REF)return 1;const a=x[sortKey],b=y[sortKey];if(a==null)return 1;if(b==null)return -1;if(typeof a=="string"||typeof b=="string")return String(a).localeCompare(String(b))*sortDir;return (a-b)*sortDir;});}
function spark(curve,ref){if(!curve)return "";const n=curve.length,hi=Math.max(...curve,...(ref||[0]),1e-6);
 const pts=curve.map((v,i)=>`${(i/(n-1)*100).toFixed(2)},${(34-32*v/hi).toFixed(2)}`).join(" ");
 const rp=ref?ref.map((v,i)=>`${(i/(ref.length-1)*100).toFixed(2)},${(34-32*v/hi).toFixed(2)}`).join(" "):"";
 return `<svg viewBox="0 0 100 36" preserveAspectRatio="none">${rp?`<polyline points="${rp}" fill="none" stroke="var(--ref)" stroke-width="1" opacity=".6"/>`:""}<polyline points="${pts}" fill="none" stroke="var(--bar)" stroke-width="1.2"/></svg>`;}
function render(){
 const rows=sorted();const th=$("#tbl thead"),tb=$("#tbl tbody");
 th.innerHTML="<tr><th>&#9733;</th><th>arm</th>"+COLS.map(c=>`<th data-k="${c[0]}" class="${c[0]==sortKey?'s':''}">${c[1]}${c[0]==sortKey?(sortDir>0?" &#9650;":" &#9660;"):""}</th>`).join("")+"</tr>";
 th.querySelectorAll("th[data-k]").forEach(h=>h.onclick=()=>{const k=h.dataset.k;if(sortKey==k)sortDir*=-1;else{sortKey=k;sortDir=1;}sortSel.value=sortKey;render();});
 tb.innerHTML=rows.filter(visible).map(r=>`<tr data-a="${r.arm}" class="${picks.has(r.arm)?'sel':''}"><td>${picks.has(r.arm)?"&#9733;":""}</td><td><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colorOf(r)};margin-right:6px"></i>${r.arm}</td>`+
  COLS.map(c=>`<td${barbg(c[0],r[c[0]])}>${fmtv(c[0],r[c[0]])}</td>`).join("")+"</tr>").join("");
 tb.querySelectorAll("tr").forEach(tr=>tr.onclick=()=>{const c=document.getElementById("card-"+tr.dataset.a);if(c){c.scrollIntoView({behavior:"smooth",block:"center"});c.animate([{boxShadow:"0 0 0 3px var(--pick)"},{boxShadow:"none"}],{duration:1400});}});
 const g=$("#grid");
 g.innerHTML=rows.map(r=>`<div class="card ${picks.has(r.arm)?'sel':''} ${visible(r)?'':'hid'}" id="card-${r.arm}" data-a="${r.arm}">
  <video src="${srcRow(r)}"${posterAttr(r)} preload="none" loop playsinline muted></video>
  <div class="ch"><span class="nm"><i style="display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;background:${colorOf(r)}"></i>${r.arm}</span><span class="chip">${r.group}</span><button class="star ${picks.has(r.arm)?'on':''}" title="star">&#9733;</button></div>
  <div class="desc">${r.desc||""}</div>
  <div class="mets">${COLS.map(c=>r[c[0]]==null?"":`<div><span>${c[1].split(" (")[0]}</span>${fmtv(c[0],r[c[0]])}</div>`).join("")}</div>
  <div class="spark">${spark(r.curve,r.ref_curve)}</div>
  <div class="acts" style="display:flex;gap:6px;padding:0 10px 10px;flex-wrap:wrap"><button class="toA">&#8594; A</button><button class="toB">&#8594; B</button><button class="fs" title="fullscreen">&#9974;</button><button class="open" title="open file">&#8599;</button></div>
 </div>`).join("");
 g.querySelectorAll(".card").forEach(c=>{const a=c.dataset.a,v=c.querySelector("video");
  c.onmouseenter=()=>{if(hover&&v.paused){v.muted=true;v.play().catch(()=>{});}};
  c.onmouseleave=()=>{if(hover&&v.muted){v.pause();}};
  v.onclick=()=>{if(v.muted){v.muted=false;v.currentTime=0;v.play();}else{v.muted=true;v.pause();}};
  c.querySelector(".star").onclick=()=>{picks.has(a)?picks.delete(a):picks.add(a);save();render();};
  c.querySelector(".toA").onclick=()=>setAB(a,null);c.querySelector(".toB").onclick=()=>setAB(null,a);
  c.querySelector(".fs").onclick=()=>goFS(v,[v]);
  c.querySelector(".open").onclick=()=>window.open(srcRow(rowOf(a)));});
 $("#count").textContent=`${rows.filter(visible).length} of ${rows.length} clips shown, ${picks.size} starred`;
 renderPicks();}
function renderPicks(){const ps=ROWS.filter(r=>picks.has(r.arm));
 const hdr="| arm | "+COLS.map(c=>c[1]).join(" | ")+" |\n|"+"---|".repeat(COLS.length+1)+"\n";
 $("#picks").value=ps.length?hdr+ps.map(r=>`| ${r.arm} | `+COLS.map(c=>fmtv(c[0],r[c[0]])).join(" | ")+" |").join("\n"):"(no stars yet)";}
const VA=()=>$("#va"),VB=()=>$("#vb");let wipeMode=false;
const FPS = __FPS__;
let loopA=null,loopB=null;const looping=true;
function dur(){const d=VA().duration;return isFinite(d)&&d>0?d:0;}
function seekAll(t){VA().currentTime=t;VB().currentTime=t;}
// ---- player settings (gear): editable region, frame counter, blips, marks ----
const SLS="cmp.set."+document.title;
let SET=Object.assign({fc:false,blip:true,markblip:true,spanA:null,spanB:null,marks:""},JSON.parse(localStorage.getItem(SLS)||"{}"));
function saveSet(){localStorage.setItem(SLS,JSON.stringify(SET));}
function rowSpan(){const r=rowOf(A);return r&&r.spans&&r.spans[0]?r.spans[0]:null;}
function bands(){if(SET.spanA!=null&&SET.spanB!=null)return [[SET.spanA,SET.spanB]];const r=rowOf(A);return (r&&r.spans)||[];}
function markList(){return String(SET.marks||"").split(",").map(x=>parseFloat(x)).filter(x=>isFinite(x));}
$("#gear").onclick=()=>{const pn=$("#setpanel");const open=pn.style.display=="none";pn.style.display=open?"":"none";$("#gear").classList.toggle("on",open);
 const sp=bands()[0]||[0,0];$("#spanA").value=sp[0];$("#spanB").value=sp[1];
 $("#setFc").checked=SET.fc;$("#setBlip").checked=SET.blip;$("#setMarkBlip").checked=SET.markblip;$("#marks").value=SET.marks;};
$("#spanA").oninput=()=>{const sp=bands()[0]||[0,0];SET.spanA=+$("#spanA").value;if(SET.spanB==null)SET.spanB=sp[1];saveSet();};
$("#spanB").oninput=()=>{const sp=bands()[0]||[0,0];SET.spanB=+$("#spanB").value;if(SET.spanA==null)SET.spanA=sp[0];saveSet();};
$("#spanReset").onclick=()=>{SET.spanA=SET.spanB=null;saveSet();const sp=bands()[0]||[0,0];$("#spanA").value=sp[0];$("#spanB").value=sp[1];};
$("#setFc").onchange=e=>{SET.fc=e.target.checked;saveSet();};
$("#setBlip").onchange=e=>{SET.blip=e.target.checked;saveSet();};
$("#setMarkBlip").onchange=e=>{SET.markblip=e.target.checked;saveSet();};
$("#marks").oninput=()=>{SET.marks=$("#marks").value;saveSet();};
let lastT=0,flashUntil=0,flashColor="#3fa66a";
function flash(c){flashColor=c;flashUntil=performance.now()+350;}
function tickCross(){const t=VA().currentTime||0;
 if(t<lastT-0.2){lastT=t;return;}
 for(const sp of bands()){const a=sp[0]/FPS,b=sp[1]/FPS;
  if(SET.blip){if(lastT<a&&t>=a)flash("#3fa66a");if(lastT<b&&t>=b)flash("#d7732a");}}
 if(SET.markblip)for(const m of markList()){const tm=m/FPS;if(lastT<tm&&t>=tm){flash("#3f93d6");break;}}
 lastT=t;}
function drawOvl(){const fc=$("#fcv"),bl=$("#blip");
 const t=VA().currentTime||0;
 fc.style.display=SET.fc?"":"none";if(SET.fc)fc.textContent="frame "+Math.round(t*FPS);
 const inR=SET.blip&&bands().some(sp=>t>=sp[0]/FPS&&t<=sp[1]/FPS);
 if(performance.now()<flashUntil){bl.style.background=flashColor;bl.style.opacity=1;}
 else if(inR){bl.style.background="#3fa66a";bl.style.opacity=0.55;}
 else bl.style.opacity=0;}
// ---- pro timeline: stereo waveform (L top / R bottom), sliding playhead, draggable [ ] loop brackets, data lanes ----
const TL=$("#tlc");let wf=null,tlDrag=null;
function tlX(t){const d=dur();return d?t/d*TL.clientWidth:0;}
function tlT(x){const d=dur();return d?Math.max(0,Math.min(d,x/TL.clientWidth*d)):0;}
function tlResize(){const r=window.devicePixelRatio||1;TL.width=Math.max(1,TL.clientWidth*r);TL.height=Math.max(1,TL.clientHeight*r);TL.getContext("2d").setTransform(r,0,0,r,0,0);}
async function loadWave(){wf=null;const r=rowOf(A);if(!r)return;const gen=loadWave.gen=(loadWave.gen||0)+1;
 try{const ab=await(await fetch(srcRow(r))).arrayBuffer();
  const AC=window.AudioContext||window.webkitAudioContext;const ac=new AC();
  const buf=await ac.decodeAudioData(ab);ac.close();
  if(gen!=loadWave.gen)return;
  const N=1000,c0=buf.getChannelData(0),c1=buf.numberOfChannels>1?buf.getChannelData(1):c0;
  const bucket=c=>{const out=[],step=Math.max(1,Math.floor(c.length/N));
   for(let i=0;i<N;i++){let m=0;const st=i*step,e=Math.min(c.length,st+step);
    for(let j=st;j<e;j+=2){const v=Math.abs(c[j]);if(v>m)m=v;}out.push(m);}return out;};
  wf={L:bucket(c0),R:bucket(c1)};
 }catch(e){wf=null;}}
function drawTL(){const W=TL.clientWidth,H=TL.clientHeight,cx=TL.getContext("2d"),d=dur();
 cx.clearRect(0,0,W,H);cx.fillStyle="#14171c";cx.fillRect(0,0,W,H);
 const mid=H/2,ra=rowOf(A);
 if(d){if(loopA==null)loopA=0;if(loopB==null||loopB>d+0.001)loopB=d;if(loopA>d)loopA=0;}
 if(d){cx.fillStyle="rgba(63,147,214,.16)";
  for(const sp of bands()){cx.fillRect(tlX(sp[0]/FPS),0,Math.max(2,tlX((sp[1]-sp[0])/FPS)),H);}
  for(const m of markList()){const x=tlX(m/FPS);cx.fillStyle="#3f93d6";cx.beginPath();cx.moveTo(x-4,0);cx.lineTo(x+4,0);cx.lineTo(x,6);cx.closePath();cx.fill();cx.fillStyle="rgba(63,147,214,.16)";}}
 if(wf){const n=wf.L.length;cx.fillStyle="rgba(154,163,173,.85)";
  for(let i=0;i<n;i++){const x=i/n*W,w=Math.max(1,W/n);
   const l=wf.L[i]*(mid-3),r=wf.R[i]*(mid-3);
   cx.fillRect(x,mid-2-l,w,l);cx.fillRect(x,mid+2,w,r);}
  cx.fillStyle="rgba(255,255,255,.25)";cx.fillRect(0,mid-1,W,2);}
 else{cx.fillStyle="rgba(255,255,255,.15)";cx.fillRect(0,mid-1,W,2);}
 for(const pair of [[rowOf(A),"#3f93d6"],[rowOf(B),"#c2456b"]]){const r=pair[0];if(!r||!r.curve)continue;
  const c=r.curve,hi=Math.max(...c,1e-6);cx.strokeStyle=pair[1];cx.lineWidth=1.2;cx.beginPath();
  c.forEach((v,i)=>{const x=i/(c.length-1)*W,y=H-4-(H-8)*v/hi;i?cx.lineTo(x,y):cx.moveTo(x,y);});cx.stroke();}
 if(loopA!=null&&loopB!=null){const xa=tlX(loopA),xb=tlX(loopB);
  cx.fillStyle="rgba(242,201,76,.16)";cx.fillRect(xa,0,xb-xa,H);
  cx.strokeStyle="#f2c94c";cx.lineWidth=2;cx.fillStyle="#f2c94c";
  const brk=(x,dir)=>{cx.beginPath();cx.moveTo(x+7*dir,1);cx.lineTo(x,1);cx.lineTo(x,H-1);cx.lineTo(x+7*dir,H-1);cx.stroke();
   cx.fillRect(dir>0?x:x-12,0,12,10);cx.fillRect(dir>0?x:x-12,H-10,12,10);};   // grab tabs top+bottom
  brk(xa,1);brk(xb,-1);}
 if(d){const x=tlX(VA().currentTime);cx.fillStyle="#fff";cx.fillRect(x-0.5,0,1.5,H);
  cx.beginPath();cx.moveTo(x-5,0);cx.lineTo(x+5,0);cx.lineTo(x,7);cx.closePath();cx.fillStyle="#f2c94c";cx.fill();}
 const t=VA().currentTime||0;
 $("#tnum").textContent=t.toFixed(2)+" s \u00b7 frame "+Math.round(t*FPS)+((loopA!=null&&loopB!=null)?" \u00b7 loop "+Math.round(loopA*FPS)+"-"+Math.round(loopB*FPS):"");}
TL.addEventListener("pointerdown",e=>{const x=e.offsetX,y=e.offsetY,Hc=TL.clientHeight;
 const tab=y<14||y>Hc-14;
 const near=(t,tol)=>t!=null&&Math.abs(tlX(t)-x)<tol;
 tlDrag=near(loopA,tab?14:5)?"in":near(loopB,tab?14:5)?"out":"seek";
 TL.setPointerCapture(e.pointerId);if(tlDrag=="seek")tlMove(e);});
function tlMove(e){if(!tlDrag)return;const t=tlT(e.offsetX);
 if(tlDrag=="seek")seekAll(t);
 else if(tlDrag=="in"){loopA=loopB!=null?Math.min(t,loopB-0.05):t;
  if(VA().currentTime<loopA)seekAll(loopA);}
 else{loopB=loopA!=null?Math.max(t,loopA+0.05):t;
  if(VA().currentTime>loopB)seekAll(Math.max(loopA||0,loopB-0.05));}}
TL.addEventListener("pointermove",tlMove);
TL.addEventListener("pointerup",()=>tlDrag=null);
TL.addEventListener("dblclick",()=>{loopA=0;loopB=dur()||null;});
function loopTick(){if(looping&&loopA!=null&&loopB!=null){const t=VA().currentTime;if(t>loopB+0.02||t<loopA-0.35)seekAll(loopA);}}
(function tlRaf(){tickCross();drawTL();drawOvl();requestAnimationFrame(tlRaf);})();
window.addEventListener("resize",tlResize);setTimeout(tlResize,50);
$("#lin").onclick=()=>{loopA=VA().currentTime;if(loopB!=null&&loopB<=loopA)loopB=null;};
$("#lout").onclick=()=>{loopB=VA().currentTime;if(loopA!=null&&loopA>=loopB)loopA=null;};
$("#lclear").onclick=()=>{loopA=0;loopB=dur()||null;};
function setAB(a,b){if(a!==null)A=a;if(b!==null)B=b;loadAB();}
function srcOf(x){const r=rowOf(x);return r?srcRow(r):"";}
function loadAB(){$("#aname").textContent=A||"-";$("#bname").textContent=B||"-";$("#al").textContent=A||"";$("#bl").textContent=B||"";
 const a=VA(),b=VB();const t=a.currentTime||0,was=!a.paused;
 a.preload="auto";b.preload="auto";a.src=srcOf(A);b.src=srcOf(B);
 const ready=v=>new Promise(r=>{if(v.readyState>=2)return r();v.addEventListener("loadeddata",r,{once:true});setTimeout(r,1500);});
 Promise.all([ready(a),ready(b)]).then(()=>{a.currentTime=t;b.currentTime=t;a.playbackRate=1;b.playbackRate=1;applyHear();if(was){a.play();b.play();}});
 const ra=rowOf(A),rb=rowOf(B);
 $("#h2hm").innerHTML=[ra,rb].filter(Boolean).map((r,i)=>`<b>${i?"B":"A"}</b> ${r.desc||""} &#183; `+COLS.map(c=>r[c[0]]==null?"":`${c[1].split(" (")[0]} ${fmtv(c[0],r[c[0]])}`).filter(Boolean).join(" &#183; ")).join("<br>");
 loadWave();tlResize();
 document.getElementById("h2h").scrollIntoView({behavior:"smooth",block:"start"});}
function applyHear(){const h=$("#hear").value;const a=VA(),b=VB();if(a){a.muted=h!="a";a.classList.toggle("audioon",h=="a");}if(b){b.muted=h!="b";b.classList.toggle("audioon",h=="b");}
 document.querySelectorAll("#hearseg button").forEach(x=>x.classList.toggle("on",x.dataset.h==h));}
$("#hear").onchange=applyHear;
document.querySelectorAll("#hearseg button").forEach(b=>b.onclick=()=>{$("#hear").value=b.dataset.h;applyHear();});
$("#play").onclick=()=>{if(VA().paused){VB().currentTime=VA().currentTime;VA().play();VB().play();}else{VA().pause();VB().pause();}};
$("#restart").onclick=()=>{VA().currentTime=0;VB().currentTime=0;VA().play();VB().play();};
$("#flip").onclick=()=>{[A,B]=[B,A];loadAB();};
$("#mode").onclick=()=>{wipeMode=!wipeMode;$("#mode").innerHTML=wipeMode?"&#9706; side by side":"&#9707; wipe";$("#mode").classList.toggle("on",wipeMode);$("#wipelab").style.display=wipeMode?"":"none";$("#pane").classList.toggle("wipe",wipeMode);};
function syncPair(m,sl){if(sl.readyState<3)return;
 const d=m.currentTime-sl.currentTime,ad=Math.abs(d);
 if(ad>0.5){sl.currentTime=m.currentTime;sl.playbackRate=1;}
 else if(ad>0.05){sl.playbackRate=Math.max(0.9,Math.min(1.1,1+d*0.5));}
 else if(sl.playbackRate!=1){sl.playbackRate=1;}}
function bindSync(){const a=$("#va"),b=$("#vb");const hearing=()=>$("#hear").value;
 a.ontimeupdate=()=>{if(hearing()!="b")syncPair(a,b);loopTick();};
 b.ontimeupdate=()=>{if(hearing()=="b")syncPair(b,a);};
 a.onplay=()=>{b.play().catch(()=>{});$("#play").innerHTML="&#10074;&#10074;";};
 a.onpause=()=>{b.pause();$("#play").innerHTML="&#9654;";};}
$("#wipe").oninput=e=>{$("#pane").style.setProperty("--w",e.target.value+"%");};
document.addEventListener("keydown",e=>{if(e.target.tagName=="TEXTAREA"||e.target.tagName=="SELECT")return;
 if(e.key==" "&&document.activeElement.tagName!="VIDEO"){e.preventDefault();$("#play").click();}
 if(e.key=="f"){$("#flip").click();}if(e.key=="i"){$("#lin").click();}if(e.key=="o"){$("#lout").click();}if(e.key=="1"){$("#hear").value="a";applyHear();}if(e.key=="2"){$("#hear").value="b";applyHear();}});
$("#grp").onchange=render;
$("#hoverplay").onclick=()=>{hover=!hover;$("#hoverplay").classList.toggle("on",hover);};
$("#onlysel").onclick=()=>{onlySel=!onlySel;$("#onlysel").classList.toggle("on",onlySel);render();};
$("#copy").onclick=()=>{navigator.clipboard.writeText($("#picks").value);};
$("#clear").onclick=()=>{picks.clear();save();render();};
function goFS(el,vids){(el.requestFullscreen||el.webkitRequestFullscreen).call(el);vids.forEach(v=>v.controls=true);}
document.addEventListener("fullscreenchange",()=>{if(!document.fullscreenElement)document.querySelectorAll("video").forEach(v=>v.controls=false);});
function fixSticky(){document.documentElement.style.setProperty("--thtop",document.querySelector(".bar").offsetHeight+"px");}
window.addEventListener("resize",fixSticky);
$("#fsPane").onclick=()=>goFS($("#pane"),[VA()]);
// ---- export: record the live A/B view for the loop section ----
function pickMime(){return ["video/mp4;codecs=avc1.640028","video/mp4;codecs=avc1.42E01E","video/mp4;codecs=avc1","video/mp4","video/webm;codecs=vp9","video/webm"].find(m=>MediaRecorder.isTypeSupported(m));}
const XFIELDS=[["__arm","arms (A vs B)"],["desc","description"]].concat(COLS.map(c=>[c[0],c[1]]));
function xval(r,k){if(!r)return "";if(k=="__arm")return r.arm;if(k=="desc")return r.desc||"";return fmtv(k,r[k]);}
$("#export").onclick=()=>{const d=dur();if(!d){alert("load a pair first");return;}
 $("#xfields").innerHTML=XFIELDS.map(([k,l],i)=>`<tr><td style="text-align:left">${l}</td><td style="text-align:center"><input type="checkbox" data-x="top" data-k="${k}" ${i==0?"checked":""}></td><td style="text-align:center"><input type="checkbox" data-x="end" data-k="${k}" checked></td></tr>`).join("");
 const a=loopA!=null?loopA:0,b=loopB!=null?loopB:d;
 $("#xinfo").textContent=`${A} vs ${B} \u00b7 ${wipeMode?"wipe (current slider)":"side by side"} \u00b7 ${a.toFixed(2)}s\u2013${b.toFixed(2)}s (${((b-a)).toFixed(2)}s) + 2s end card \u00b7 real-time capture \u00b7 ${pickMime()||"no recorder"}`;
 const cap=("VideoEncoder" in window)&&(typeof Mp4Muxer!="undefined"||typeof WebMMuxer!="undefined");
 $("#xprecise").checked=cap;$("#xprecise").disabled=!cap;
 $("#xstat").textContent="";$("#xdlg").style.display="";};
$("#xcancel").onclick=()=>{$("#xdlg").style.display="none";};
$("#xgo").onclick=async()=>{
 const picksT=[...document.querySelectorAll('#xfields input[data-x="top"]:checked')].map(x=>x.dataset.k);
 const picksE=[...document.querySelectorAll('#xfields input[data-x="end"]:checked')].map(x=>x.dataset.k);
 const va=VA(),vb=VB(),ra=rowOf(A),rb=rowOf(B);
 const d=dur(),t0=loopA!=null?loopA:0,t1=loopB!=null?loopB:d;
 const W=va.videoWidth||864,H=va.videoHeight||480;
 const cw=wipeMode?W:2*W+4, ch=H;
 const cv=document.createElement("canvas");cv.width=cw;cv.height=ch;const cx=cv.getContext("2d");
 const stream=cv.captureStream(FPS);
 if($("#xaudio").checked){const hv=$("#hear").value=="b"?vb:va;
  try{const at=hv.captureStream().getAudioTracks()[0];if(at)stream.addTrack(at);}catch(e){}}
 const mime=pickMime();
 // honour the #xrate selector here too; the precise path already reads it
 const rrate=(parseInt($("#xrate").value)||24)*1e6;
 const rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:rrate});
 const chunks=[];rec.ondataavailable=e=>chunks.push(e.data);
 const done=new Promise(r=>rec.onstop=r);
 const wasLoopA=va.loop,wasLoopB=vb.loop;va.loop=vb.loop=false;
 const topLines=picksT.map(k=>k=="__arm"?`A ${A}  vs  B ${B}`:`${XFIELDS.find(f=>f[0]==k)[1]}:  A ${xval(ra,k)}   B ${xval(rb,k)}`);
 function drawTop(){if(!topLines.length)return;cx.fillStyle="rgba(0,0,0,.55)";cx.fillRect(0,0,cw,14+26*topLines.length);
  cx.fillStyle="#fff";cx.font="20px system-ui,sans-serif";cx.textBaseline="top";
  topLines.forEach((t,i)=>cx.fillText(t,12,10+26*i));}
 function drawAB(){cx.fillStyle="#000";cx.fillRect(0,0,cw,ch);
  if(wipeMode){cx.drawImage(va,0,0,W,H);const w=($("#wipe").value/100)*W;
   cx.save();cx.beginPath();cx.rect(w,0,W-w,H);cx.clip();cx.drawImage(vb,0,0,W,H);cx.restore();
   cx.fillStyle="#f2c94c";cx.fillRect(w-1,0,2,H);}
  else{cx.drawImage(va,0,0,W,H);cx.drawImage(vb,W+4,0,W,H);
   cx.fillStyle="rgba(0,0,0,.55)";cx.font="20px system-ui,sans-serif";cx.textBaseline="top";
   cx.fillRect(0,ch-34,90,34);cx.fillRect(W+4,ch-34,90,34);
   cx.fillStyle="#fff";cx.fillText("A",12,ch-28);cx.fillText("B",W+16,ch-28);}
  drawTop();
  // bake the frame counter + region ball into the export when enabled
  const tt=va.currentTime||0;let bx=cw-16;
  if(SET.fc){cx.font="20px ui-monospace,monospace";cx.textBaseline="top";
   const txt="frame "+Math.round(tt*FPS),w=cx.measureText(txt).width;
   cx.fillStyle="rgba(0,0,0,.55)";cx.fillRect(cw-w-28,8,w+20,30);
   cx.fillStyle="#fff";cx.fillText(txt,cw-w-18,14);bx=cw-w-44;}
  const inR=SET.blip&&bands().some(sp=>tt>=sp[0]/FPS&&tt<=sp[1]/FPS);
  let col=null,op=0;
  if(performance.now()<flashUntil){col=flashColor;op=1;}else if(inR){col="#3fa66a";op=0.55;}
  if(col){cx.globalAlpha=op;cx.fillStyle=col;cx.beginPath();cx.arc(bx-8,23,8,0,7);cx.fill();cx.globalAlpha=1;}}
 function drawEnd(){cx.fillStyle="#000";cx.fillRect(0,0,cw,ch);cx.fillStyle="#fff";
  cx.font="26px system-ui,sans-serif";cx.textBaseline="top";
  let y=40;cx.fillText(`A ${A}   vs   B ${B}`,40,y);y+=44;cx.font="20px system-ui,sans-serif";
  for(const k of picksE){if(k=="__arm")continue;
   cx.fillText(`${XFIELDS.find(f=>f[0]==k)[1]}:  A ${xval(ra,k)}   B ${xval(rb,k)}`,40,y);y+=30;if(y>ch-40)break;}}
 if($("#xprecise").checked&&("VideoEncoder" in window)&&(typeof Mp4Muxer!="undefined"||typeof WebMMuxer!="undefined")){
  $("#xdlg").style.display="none";$("#export").disabled=true;
  try{await exportPrecise({va,vb,t0,t1,cw,ch,cv,drawAB,drawEnd});}
  catch(err){console.error("precise export failed, falling back to realtime",err);
   va.loop=wasLoopA;vb.loop=wasLoopB;$("#export").disabled=false;$("#export").innerHTML="&#11123; export";alert("precise export failed ("+err+"); try unchecking precise");return;}
  va.loop=wasLoopA;vb.loop=wasLoopB;$("#export").disabled=false;$("#export").innerHTML="&#11123; export";return;}
 $("#xdlg").style.display="none";$("#export").disabled=true;$("#export").textContent="recording\u2026";
 seekAll(t0);await new Promise(r=>setTimeout(r,300));
 rec.start(250);va.play();vb.play();
 let phase="main",endAt=0,raf;
 await new Promise(res=>{const step=()=>{ 
  if(phase=="main"){drawAB();
   if(va.currentTime>=t1-0.02||va.ended){phase="end";endAt=performance.now()+2000;va.pause();vb.pause();}}
  else{drawEnd();if(performance.now()>endAt){cancelAnimationFrame(raf);return res();}}
  raf=requestAnimationFrame(step);};raf=requestAnimationFrame(step);});
 rec.stop();await done;
 va.loop=wasLoopA;vb.loop=wasLoopB;$("#export").disabled=false;$("#export").innerHTML="&#11123; export";
 const ext=mime.startsWith("video/mp4")?"mp4":"webm";
 const blob=new Blob(chunks,{type:mime});const u=URL.createObjectURL(blob);
 const el=document.createElement("a");el.href=u;el.download=`${A}_vs_${B}_f${Math.round(t0*FPS)}-${Math.round(t1*FPS)}.${ext}`;el.click();
 setTimeout(()=>URL.revokeObjectURL(u),10000);};
async function exportPrecise(o){
 const {va,vb,t0,t1,cw,ch,cv,drawAB,drawEnd}=o;
 const wantAudio=$("#xaudio").checked;
 const RATE=(parseInt($("#xrate").value)||24)*1e6;
 const want=$("#xcodec").value;
 const ok=async c=>(await VideoEncoder.isConfigSupported({codec:c,width:cw,height:ch,bitrate:RATE,framerate:FPS})).supported;
 let vcodec=null,mp4ok=false;
 if(want=="mp4"&&typeof Mp4Muxer!="undefined"&&await ok("avc1.640028")){vcodec="avc1.640028";mp4ok=true;}
 else if(want=="av1"&&typeof WebMMuxer!="undefined"&&await ok("av01.0.08M.08")){vcodec="av01.0.08M.08";}
 if(!vcodec&&typeof WebMMuxer!="undefined"&&await ok("vp09.00.10.08"))vcodec="vp09.00.10.08";
 if(!vcodec&&typeof Mp4Muxer!="undefined"&&await ok("avc1.640028")){vcodec="avc1.640028";mp4ok=true;}
 if(!vcodec)throw new Error("no supported encoder+muxer");
 const webmok=!mp4ok;
 let abuf=null;
 if(wantAudio&&("AudioEncoder" in window)){try{
  const hr=$("#hear").value=="b"?rowOf(B):rowOf(A);
  const ab=await(await fetch(srcRow(hr))).arrayBuffer();
  const AC=window.AudioContext||window.webkitAudioContext;const ac=new AC();
  abuf=await ac.decodeAudioData(ab);ac.close();
  if(!(await AudioEncoder.isConfigSupported({codec:"opus",sampleRate:abuf.sampleRate,numberOfChannels:Math.min(2,abuf.numberOfChannels),bitrate:192000})).supported)abuf=null;
 }catch(e){abuf=null;}}
 const sr=abuf?abuf.sampleRate:48000,nch=abuf?Math.min(2,abuf.numberOfChannels):2;
 let muxer,target;
 if(mp4ok){target=new Mp4Muxer.ArrayBufferTarget();
  muxer=new Mp4Muxer.Muxer({target,fastStart:"in-memory",video:{codec:"avc",width:cw,height:ch},audio:abuf?{codec:"opus",sampleRate:sr,numberOfChannels:nch}:undefined});}
 else{target=new WebMMuxer.ArrayBufferTarget();
  muxer=new WebMMuxer.Muxer({target,video:{codec:vcodec.startsWith("av01")?"V_AV1":"V_VP9",width:cw,height:ch},audio:abuf?{codec:"A_OPUS",sampleRate:sr,numberOfChannels:nch}:undefined});}
 const venc=new VideoEncoder({output:(c,m)=>muxer.addVideoChunk(c,m),error:e=>{throw e;}});
 const vcfg={codec:vcodec,width:cw,height:ch,bitrate:RATE,framerate:FPS,latencyMode:"quality"};
 if(mp4ok)vcfg.avc={format:"avc"};
 venc.configure(vcfg);
 const seek=(v,t)=>new Promise(r=>{let done=false;const f=()=>{if(done)return;done=true;v.removeEventListener("seeked",f);r();};
  v.addEventListener("seeked",f);v.currentTime=Math.min(t,(v.duration||t+1)-0.0001);setTimeout(f,800);});
 va.pause();vb.pause();
 const n=Math.max(1,Math.round((t1-t0)*FPS)),us=f=>Math.round(f*1e6/FPS);
 for(let i=0;i<n;i++){const t=t0+i/FPS;
  await seek(va,t);await seek(vb,t);
  drawAB();
  const vf=new VideoFrame(cv,{timestamp:us(i),duration:us(1)});
  venc.encode(vf,{keyFrame:i%(FPS*2)==0});vf.close();
  if(i%6==0){$("#export").textContent="export "+Math.round(100*i/n)+"%";await new Promise(r=>setTimeout(r,0));}
  while(venc.encodeQueueSize>4)await new Promise(r=>setTimeout(r,2));}
 drawEnd();
 for(let i=0;i<2*FPS;i++){const vf=new VideoFrame(cv,{timestamp:us(n+i),duration:us(1)});venc.encode(vf,{keyFrame:i==0});vf.close();}
 $("#export").textContent="finishing\u2026";
 await venc.flush();venc.close();
 if(abuf){const aenc=new AudioEncoder({output:(c,m)=>muxer.addAudioChunk(c,m),error:e=>{throw e;}});
  aenc.configure({codec:"opus",sampleRate:sr,numberOfChannels:nch,bitrate:192000});
  const s0=Math.floor(t0*sr),s1=Math.min(abuf.length,Math.ceil(t1*sr));
  const CH=[];for(let c=0;c<nch;c++)CH.push(abuf.getChannelData(Math.min(c,abuf.numberOfChannels-1)));
  const STEP=Math.round(sr/50);
  for(let sp=s0;sp<s1;sp+=STEP){const len=Math.min(STEP,s1-sp);
   const data=new Float32Array(len*nch);
   for(let c=0;c<nch;c++)data.set(CH[c].subarray(sp,sp+len),c*len);
   const ad=new AudioData({format:"f32-planar",sampleRate:sr,numberOfFrames:len,numberOfChannels:nch,timestamp:Math.round((sp-s0)/sr*1e6),data});
   aenc.encode(ad);ad.close();
   if(aenc.encodeQueueSize>8)await new Promise(r=>setTimeout(r,2));}
  await aenc.flush();aenc.close();}
 muxer.finalize();
 const type=mp4ok?"video/mp4":"video/webm",ext=mp4ok?"mp4":"webm";
 const blob=new Blob([target.buffer],{type});const u=URL.createObjectURL(blob);
 const el=document.createElement("a");el.href=u;el.download=`${A}_vs_${B}_f${Math.round(t0*FPS)}-${Math.round(t1*FPS)}.${ext}`;el.click();
 setTimeout(()=>URL.revokeObjectURL(u),10000);}
bindSync();render();fixSticky();setAB(REF,REF);
</script></body></html>'''

if __name__ == "__main__":
    m = json.load(open(sys.argv[1]))
    out = build(m)
    open(sys.argv[2], "w").write(out)
    print("wrote %s (%d bytes, %d rows)" % (sys.argv[2], len(out), len(m["rows"])))
