import { useState, useEffect, useRef } from "react";

const CW = 1200, CH = 900, R = 160, SESSION = 90, SCAN = 5, RESP = 30, CUTOFF = 10, BUFFER = 3;

const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const fmt = v => "₱" + v.toFixed(2);
const pct = v => Math.round(v) + "%";

const score = (w, h) => {
  const d = dist(w, h);
  const proximity = Math.max(0, 1 - d / h.radius);
  const stars = w.stars / 5;
  const acc = w.acceptance / 100;
  return proximity * 0.4 + stars * 0.35 + acc * 0.25;
};

const mkHost = (n, x, y) => ({ id: "H" + n, label: "GigHost " + n, x, y, radius: R, dispatching: false, session: null, sessionTimer: 0, extended: false, extendedTimer: 0, status: "idle", buf: 0, basePrice: 100, currentPrice: 100, increaseRate: 10, declineCount: 0 });
const mkWorker = (n, x, y) => ({ id: "W" + n, label: "GigWorker " + n, x, y, toggle: false, state: "free", activeGig: false, declined: [], reqTimer: 0, hasReq: false, reqFrom: null, offeredPrice: null, stars: 4.5, acceptance: 85 });

export default function App() {
  const [hosts, setHosts] = useState([mkHost(1, 300, 400)]);
  const [workers, setWorkers] = useState([mkWorker(1, 750, 450)]);
  const [log, setLog] = useState([]);
  const [nextH, setNextH] = useState(2);
  const [nextW, setNextW] = useState(2);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(null);
  const [view, setView] = useState("sim");
  const drag = useRef(null);
  const panRef = useRef(null);
  const hoverTimer = useRef(null);
  const scanTick = useRef(0);
  const svgRef = useRef(null);

  const addLog = (msg, type) => setLog(l => [...l.slice(-80), { msg, type }]);

  useEffect(() => {
    const interval = setInterval(() => {
      scanTick.current += 1;
      const doScan = scanTick.current % SCAN === 0;
      setWorkers(prevW => {
        setHosts(prevH => {
          const ws = prevW.map(w => ({ ...w }));
          const hs = prevH.map(h => {
            if (!h.dispatching && h.buf <= 0) return h;
            const nh = { ...h };
            if (nh.buf > 0) { nh.buf = Math.max(0, nh.buf - 1); return nh; }
            const timer = nh.extended ? nh.extendedTimer : nh.sessionTimer;
            if (timer <= 0) {
              const pi = ws.findIndex(w => w.reqFrom === nh.session);
              if (pi >= 0) { addLog("Auto-declined: " + ws[pi].label, "warn"); Object.assign(ws[pi], { hasReq: false, reqFrom: null, reqTimer: 0, state: "free", offeredPrice: null }); }
              addLog("Session expired: " + nh.label, "error");
              return { ...nh, dispatching: false, status: "expired", buf: BUFFER, session: null, extended: false, extendedTimer: 0, sessionTimer: 0 };
            }
            if (nh.extended) nh.extendedTimer -= 1; else nh.sessionTimer -= 1;
            const hasPending = ws.some(w => w.reqFrom === nh.session && w.hasReq);
            if (!hasPending && !nh.extended && nh.sessionTimer > CUTOFF && doScan) {
              const eligible = ws
                .filter(w => w.toggle && w.state === "free" && !w.activeGig && !w.hasReq && !w.declined.includes(nh.session) && dist(w, nh) <= nh.radius)
                .sort((a, b) => score(b, nh) - score(a, nh));
              if (eligible.length > 0) {
                const el = eligible[0];
                const idx = ws.findIndex(w => w.id === el.id);
                Object.assign(ws[idx], { hasReq: true, reqFrom: nh.session, reqTimer: RESP, state: "pending", offeredPrice: nh.currentPrice });
                addLog(`Request → ${el.label} (⭐${el.stars} · ${pct(el.acceptance)} acc · score ${score(el,nh).toFixed(2)}) @ ${fmt(nh.currentPrice)}`, "info");
                if (nh.sessionTimer <= RESP) { nh.extended = true; nh.extendedTimer = RESP; addLog("Dispatch Extended — " + el.label, "warn"); }
              }
            }
            if (!hasPending && nh.extended) { nh.extended = false; nh.extendedTimer = 0; }
            return nh;
          });
          ws.forEach((w, i) => {
            if (!w.hasReq) return;
            ws[i].reqTimer = Math.max(0, w.reqTimer - 1);
            if (ws[i].reqTimer <= 0) {
              const h = hs.find(h => h.session === w.reqFrom);
              if (h) {
                const np = +(h.currentPrice * (1 + h.increaseRate / 100)).toFixed(2);
                const hi = hs.findIndex(hh => hh.id === h.id);
                hs[hi] = { ...hs[hi], currentPrice: np, declineCount: hs[hi].declineCount + 1 };
                addLog("Auto-declined: " + w.label + " — price → " + fmt(np), "warn");
              }
              Object.assign(ws[i], { hasReq: false, reqFrom: null, state: "free", declined: [...w.declined, w.reqFrom], offeredPrice: null });
            }
          });
          setTimeout(() => setWorkers(() => ws), 0);
          return hs;
        });
        return prevW;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const doDispatch = id => { setHosts(hs => hs.map(h => { if (h.id !== id || h.dispatching || h.buf > 0) return h; const s = uid(); addLog(h.label + " dispatched — " + s + " @ " + fmt(h.currentPrice), "success"); return { ...h, dispatching: true, session: s, sessionTimer: SESSION, status: "dispatching", extended: false, extendedTimer: 0 }; })); scanTick.current = 0; };
  const doRedispatch = id => { setHosts(hs => hs.map(h => { if (h.id !== id || h.buf > 0) return h; const s = uid(); addLog(h.label + " re-dispatched — " + s + " @ " + fmt(h.currentPrice), "success"); setWorkers(ws => ws.map(w => ({ ...w, declined: [] }))); return { ...h, dispatching: true, session: s, sessionTimer: SESSION, status: "dispatching", extended: false, extendedTimer: 0, buf: 0 }; })); scanTick.current = 0; };
  const doCancel = id => { setHosts(hs => hs.map(h => { if (h.id !== id || !h.dispatching) return h; addLog(h.label + " cancelled", "error"); setWorkers(ws => ws.map(w => w.reqFrom !== h.session ? w : { ...w, hasReq: false, reqFrom: null, reqTimer: 0, state: "free", offeredPrice: null })); return { ...h, dispatching: false, status: "cancelled", session: null, sessionTimer: 0, extended: false, extendedTimer: 0, buf: BUFFER }; })); };
  const doNewPost = id => { setHosts(hs => hs.map(h => { if (h.id !== id) return h; const s = uid(); addLog(h.label + " posted new Quick Gig — " + s + " @ " + fmt(h.basePrice), "success"); setWorkers(ws => ws.map(w => ({ ...w, declined: [] }))); return { ...h, dispatching: true, session: s, sessionTimer: SESSION, status: "dispatching", extended: false, extendedTimer: 0, buf: 0, currentPrice: h.basePrice, declineCount: 0 }; })); scanTick.current = 0; };
  const doAccept = id => { setWorkers(ws => ws.map(w => { if (w.id !== id || !w.hasReq) return w; addLog(w.label + " ACCEPTED @ " + fmt(w.offeredPrice), "success"); setHosts(hs => hs.map(h => h.session === w.reqFrom ? { ...h, dispatching: false, status: "completed", session: null } : h)); return { ...w, hasReq: false, reqFrom: null, reqTimer: 0, state: "active", activeGig: true }; })); };
  const doDecline = id => { setWorkers(ws => ws.map(w => { if (w.id !== id || !w.hasReq) return w; setHosts(hs => hs.map(h => { if (h.session !== w.reqFrom) return h; const np = +(h.currentPrice * (1 + h.increaseRate / 100)).toFixed(2); addLog(w.label + " DECLINED — price +" + h.increaseRate + "% → " + fmt(np), "warn"); return { ...h, currentPrice: np, declineCount: h.declineCount + 1 }; })); return { ...w, hasReq: false, reqFrom: null, reqTimer: 0, state: "free", declined: [...w.declined, w.reqFrom], offeredPrice: null }; })); };
  const doComplete = id => { setWorkers(ws => ws.map(w => w.id !== id ? w : { ...w, state: "free", activeGig: false, declined: [], offeredPrice: null })); addLog("Gig completed", "success"); };
  const doToggle = id => { setWorkers(ws => ws.map(w => { if (w.id !== id) return w; const t = !w.toggle; addLog(w.label + " " + (t ? "ON" : "OFF"), t ? "success" : "warn"); return { ...w, toggle: t }; })); };
  const resetPrice = id => { setHosts(hs => hs.map(h => h.id !== id ? h : { ...h, currentPrice: h.basePrice, declineCount: 0 })); };

  const getSvgPt = e => { const rect = svgRef.current?.getBoundingClientRect(); if (!rect) return { x: 0, y: 0 }; return { x: (e.clientX - rect.left - pan.x) / zoom, y: (e.clientY - rect.top - pan.y) / zoom }; };
  const onNodeDown = (e, type, id) => { e.preventDefault(); e.stopPropagation(); drag.current = { type, id }; };
  const onBgDown = e => { if (!drag.current) panRef.current = { sx: e.clientX - pan.x, sy: e.clientY - pan.y }; };
  const onMove = e => { const d = drag.current, p = panRef.current; if (d) { const pt = getSvgPt(e); if (d.type === "host") setHosts(hs => hs.map(h => h.id === d.id ? { ...h, x: pt.x, y: pt.y } : h)); else setWorkers(ws => ws.map(w => w.id === d.id ? { ...w, x: pt.x, y: pt.y } : w)); } else if (p) { setPan({ x: e.clientX - p.sx, y: e.clientY - p.sy }); } };
  const onUp = () => { drag.current = null; panRef.current = null; };
  const onWheel = e => { e.preventDefault(); const rect = svgRef.current?.getBoundingClientRect(); if (!rect) return; const mx = e.clientX - rect.left, my = e.clientY - rect.top; const nz = Math.min(3, Math.max(0.25, zoom * (e.deltaY > 0 ? 0.9 : 1.1))); setPan(p => ({ x: mx - (mx - p.x) * nz / zoom, y: my - (my - p.y) * nz / zoom })); setZoom(nz); };
  const hoverEnter = id => { clearTimeout(hoverTimer.current); setHovered(id); };
  const hoverLeave = () => { hoverTimer.current = setTimeout(() => setHovered(null), 200); };

  const logColors = { info: "#185FA5", success: "#3B6D11", warn: "#854F0B", error: "#A32D2D" };
  const NR = 26;

  const StarDisplay = ({ stars, x, y, size }) => {
    const s = size || 10;
    return [1,2,3,4,5].map(i => {
      const filled = stars >= i;
      const half = !filled && stars >= i - 0.5;
      return (
        <text key={i} x={x + (i-1)*s*1.2} y={y} fontSize={s} fill={filled || half ? "#BA7517" : "#D3D1C7"} style={{ pointerEvents: "none" }}>★</text>
      );
    });
  };

  const HostSvg = ({ h }) => {
    const on = hovered === h.id;
    const timerTxt = h.dispatching ? (h.extended ? "EXT " + h.extendedTimer + "s" : h.sessionTimer + "s") : h.buf > 0 ? "…" + h.buf + "s" : null;
    const timerCol = h.extended ? "#854F0B" : "#3B6D11";
    const by = h.y + NR + 10 / zoom, bh = 26 / zoom, br = 6 / zoom, bfs = 12 / zoom;
    return (
      <g onMouseEnter={() => hoverEnter(h.id)} onMouseLeave={hoverLeave}>
        <circle cx={h.x} cy={h.y} r={h.radius} fill={h.dispatching ? "rgba(59,109,17,0.08)" : "rgba(59,109,17,0.02)"} stroke={h.dispatching ? "#3B6D11" : "#97C459"} strokeWidth={1.5/zoom} strokeDasharray={h.dispatching?"none":(6/zoom)+" "+(4/zoom)} style={{ pointerEvents:"none" }} />
        <circle cx={h.x} cy={h.y} r={NR} fill="#EAF3DE" stroke="#3B6D11" strokeWidth={2/zoom} style={{ cursor:"grab" }} onMouseDown={e => onNodeDown(e,"host",h.id)} />
        <text x={h.x} y={h.y-4} textAnchor="middle" dominantBaseline="central" fontSize={12/zoom} fontWeight="500" fill="#27500A" style={{ pointerEvents:"none" }}>{h.id}</text>
        <text x={h.x} y={h.y+10} textAnchor="middle" dominantBaseline="central" fontSize={9/zoom} fill="#3B6D11" style={{ pointerEvents:"none" }}>{h.label}</text>
        {timerTxt && <text x={h.x} y={h.y-NR-10/zoom} textAnchor="middle" fontSize={14/zoom} fontWeight="500" fill={timerCol} style={{ pointerEvents:"none" }}>{timerTxt}</text>}
        <text x={h.x+NR+8/zoom} y={h.y-6/zoom} textAnchor="start" fontSize={13/zoom} fontWeight="500" fill="#27500A" style={{ pointerEvents:"none" }}>{fmt(h.currentPrice)}</text>
        {h.declineCount>0 && <text x={h.x+NR+8/zoom} y={h.y+10/zoom} textAnchor="start" fontSize={10/zoom} fill="#854F0B" style={{ pointerEvents:"none" }}>+{h.increaseRate}% × {h.declineCount}</text>}
        {on && (() => {
          if (!h.dispatching && h.buf===0 && h.status==="idle") return (<g style={{ cursor:"pointer" }} onClick={() => doDispatch(h.id)} onMouseEnter={() => hoverEnter(h.id)}><rect x={h.x-46/zoom} y={by} width={92/zoom} height={bh} rx={br} fill="#3B6D11"/><text x={h.x} y={by+bh*0.62} textAnchor="middle" fontSize={bfs} fill="#EAF3DE" fontWeight="500" style={{ pointerEvents:"none" }}>Dispatch</text></g>);
          if (h.dispatching) return (<g style={{ cursor:"pointer" }} onClick={() => doCancel(h.id)} onMouseEnter={() => hoverEnter(h.id)}><rect x={h.x-46/zoom} y={by} width={92/zoom} height={bh} rx={br} fill="#A32D2D"/><text x={h.x} y={by+bh*0.62} textAnchor="middle" fontSize={bfs} fill="#FCEBEB" fontWeight="500" style={{ pointerEvents:"none" }}>Cancel</text></g>);
          if (!h.dispatching && h.buf===0 && ["cancelled","expired"].includes(h.status)) return (<g style={{ cursor:"pointer" }} onClick={() => doRedispatch(h.id)} onMouseEnter={() => hoverEnter(h.id)}><rect x={h.x-56/zoom} y={by} width={112/zoom} height={bh} rx={br} fill="#854F0B"/><text x={h.x} y={by+bh*0.62} textAnchor="middle" fontSize={bfs} fill="#FAEEDA" fontWeight="500" style={{ pointerEvents:"none" }}>Re-dispatch</text></g>);
          if (!h.dispatching && h.buf===0 && h.status==="completed") return (<g style={{ cursor:"pointer" }} onClick={() => doNewPost(h.id)} onMouseEnter={() => hoverEnter(h.id)}><rect x={h.x-66/zoom} y={by} width={132/zoom} height={bh} rx={br} fill="#185FA5"/><text x={h.x} y={by+bh*0.62} textAnchor="middle" fontSize={bfs} fill="#E6F1FB" fontWeight="500" style={{ pointerEvents:"none" }}>Post New Quick Gig</text></g>);
          return null;
        })()}
      </g>
    );
  };

  const WorkerSvg = ({ w, hosts }) => {
    const on = hovered === w.id;
    const border = w.activeGig ? "#A32D2D" : w.hasReq ? "#BA7517" : w.toggle ? "#E24B4A" : "#B4B2A9";
    const fill = w.activeGig ? "#FCEBEB" : w.hasReq ? "#FAEEDA" : w.toggle ? "#FFF5F5" : "#F5F5F5";
    const tc = w.activeGig ? "#791F1F" : w.toggle ? "#791F1F" : "#5F5E5A";
    const stLabel = w.activeGig ? "ACTIVE" : w.hasReq ? "REQ "+w.reqTimer+"s" : w.toggle ? "ON" : "OFF";
    const stCol = w.activeGig ? "#A32D2D" : w.hasReq ? "#854F0B" : w.toggle ? "#3B6D11" : "#888780";
    const btns = [];
    if (!w.activeGig && !w.hasReq) btns.push({ label: w.toggle?"Toggle OFF":"Toggle ON", bg: w.toggle?"#A32D2D":"#3B6D11", tc:"#fff", fn:()=>doToggle(w.id), w:90 });
    if (w.hasReq) { btns.push({ label:"Accept",bg:"#3B6D11",tc:"#EAF3DE",fn:()=>doAccept(w.id),w:68 }); btns.push({ label:"Decline",bg:"#A32D2D",tc:"#FCEBEB",fn:()=>doDecline(w.id),w:68 }); }
    if (w.activeGig) btns.push({ label:"Complete",bg:"#185FA5",tc:"#E6F1FB",fn:()=>doComplete(w.id),w:84 });
    const gap=6/zoom, bh=26/zoom, br=6/zoom, bfs=11/zoom;
    const totalBW = btns.reduce((s,b)=>s+b.w/zoom+gap,-gap);
    let bx = w.x - totalBW/2;
    const by = w.y + NR + 10/zoom;
    const starSize = 10/zoom;
    const starY = w.y - NR - 28/zoom;
    const starX = w.x - (5*starSize*1.2)/2;

    const dispHost = hosts.find(h => h.dispatching && dist(w,h) <= h.radius);
    const wScore = dispHost ? score(w, dispHost).toFixed(2) : null;

    return (
      <g onMouseEnter={() => hoverEnter(w.id)} onMouseLeave={hoverLeave}>
        <circle cx={w.x} cy={w.y} r={NR} fill={fill} stroke={border} strokeWidth={w.hasReq?3/zoom:2/zoom} style={{ cursor:"grab" }} onMouseDown={e=>onNodeDown(e,"worker",w.id)} />
        <text x={w.x} y={w.y-4} textAnchor="middle" dominantBaseline="central" fontSize={12/zoom} fontWeight="500" fill={tc} style={{ pointerEvents:"none" }}>{w.id}</text>
        <text x={w.x} y={w.y+10} textAnchor="middle" dominantBaseline="central" fontSize={9/zoom} fill={tc} style={{ pointerEvents:"none" }}>{w.label}</text>
        <text x={w.x} y={w.y-NR-10/zoom} textAnchor="middle" fontSize={12/zoom} fontWeight="500" fill={stCol} style={{ pointerEvents:"none" }}>{stLabel}</text>
        <StarDisplay stars={w.stars} x={starX} y={starY} size={starSize} />
        <text x={w.x} y={starY - 14/zoom} textAnchor="middle" fontSize={10/zoom} fill="#888780" style={{ pointerEvents:"none" }}>{w.stars.toFixed(1)}⭐ · {pct(w.acceptance)} acc</text>
        {wScore && <text x={w.x} y={starY - 26/zoom} textAnchor="middle" fontSize={10/zoom} fontWeight="500" fill="#534AB7" style={{ pointerEvents:"none" }}>score {wScore}</text>}
        {w.offeredPrice != null && <text x={w.x} y={w.y-NR-52/zoom} textAnchor="middle" fontSize={13/zoom} fontWeight="500" fill="#27500A" style={{ pointerEvents:"none" }}>{fmt(w.offeredPrice)}</text>}
        {on && btns.map((btn,i) => {
          const bw=btn.w/zoom, cx=bx+bw/2;
          const el=(<g key={i} style={{ cursor:"pointer" }} onClick={btn.fn} onMouseEnter={()=>hoverEnter(w.id)}><rect x={bx} y={by} width={bw} height={bh} rx={br} fill={btn.bg}/><text x={cx} y={by+bh*0.62} textAnchor="middle" fontSize={bfs} fill={btn.tc} fontWeight="500" style={{ pointerEvents:"none" }}>{btn.label}</text></g>);
          bx+=bw+gap; return el;
        })}
      </g>
    );
  };

  return (
    <div style={{ fontFamily:"var(--font-sans)",color:"var(--color-text-primary)",padding:"0 0 1rem" }}>
      <div style={{ display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center" }}>
        <div style={{ display:"flex",background:"var(--color-background-secondary)",borderRadius:9,padding:3,gap:2 }}>
          {[["sim","Simulator"],["visual","Visual Flow"],["text","Text Flow"]].map(([k,lbl])=>(
            <button key={k} onClick={()=>setView(k)} style={{ fontSize:12,padding:"5px 14px",borderRadius:7,border:"none",cursor:"pointer",fontWeight:view===k?500:400,background:view===k?"var(--color-background-primary)":"transparent",color:view===k?"var(--color-text-primary)":"var(--color-text-secondary)",boxShadow:view===k?"0 0 0 0.5px var(--color-border-secondary)":"none" }}>{lbl}</button>
          ))}
        </div>
        {view==="sim" && <>
          <button onClick={()=>{setHosts(h=>[...h,mkHost(nextH,200+Math.random()*600,200+Math.random()*500)]);setNextH(n=>n+1);}} style={{ fontSize:12,padding:"5px 12px",border:"0.5px solid #3B6D11",borderRadius:8,background:"transparent",cursor:"pointer",color:"#3B6D11" }}>+ GigHost</button>
          <button onClick={()=>{setWorkers(w=>[...w,mkWorker(nextW,400+Math.random()*600,200+Math.random()*500)]);setNextW(n=>n+1);}} style={{ fontSize:12,padding:"5px 12px",border:"0.5px solid #A32D2D",borderRadius:8,background:"transparent",cursor:"pointer",color:"#A32D2D" }}>+ GigWorker</button>
          <div style={{ marginLeft:"auto",display:"flex",gap:4,alignItems:"center" }}>
            <button onClick={()=>setZoom(z=>Math.min(3,+(z*1.2).toFixed(2)))} style={{ width:30,height:30,fontSize:16,border:"0.5px solid var(--color-border-secondary)",borderRadius:6,background:"transparent",cursor:"pointer",color:"var(--color-text-primary)" }}>+</button>
            <span style={{ fontSize:11,color:"var(--color-text-secondary)",minWidth:36,textAlign:"center" }}>{Math.round(zoom*100)}%</span>
            <button onClick={()=>setZoom(z=>Math.max(0.25,+(z/1.2).toFixed(2)))} style={{ width:30,height:30,fontSize:16,border:"0.5px solid var(--color-border-secondary)",borderRadius:6,background:"transparent",cursor:"pointer",color:"var(--color-text-primary)" }}>−</button>
            <button onClick={()=>{setZoom(1);setPan({x:0,y:0});}} style={{ fontSize:11,padding:"4px 8px",border:"0.5px solid var(--color-border-secondary)",borderRadius:6,background:"transparent",cursor:"pointer",color:"var(--color-text-secondary)" }}>Reset</button>
          </div>
        </>}
      </div>

      {view==="sim" && <>
        <div ref={svgRef} onMouseDown={onBgDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} onWheel={onWheel}
          style={{ width:"100%",height:500,border:"0.5px solid var(--color-border-tertiary)",borderRadius:12,overflow:"hidden",background:"var(--color-background-secondary)",cursor:"default",userSelect:"none" }}>
          <svg width="100%" height="100%">
            <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
              {hosts.map(h=>workers.map(w=>w.reqFrom===h.session&&w.hasReq?(<line key={h.id+w.id} x1={h.x} y1={h.y} x2={w.x} y2={w.y} stroke="#BA7517" strokeWidth={1.5/zoom} strokeDasharray={(5/zoom)+" "+(3/zoom)}/>):null))}
              {hosts.map(h=><HostSvg key={h.id} h={h}/>)}
              {workers.map(w=><WorkerSvg key={w.id} w={w} hosts={hosts}/>)}
            </g>
          </svg>
        </div>

        <div style={{ marginTop:10,display:"flex",flexDirection:"column",gap:8 }}>
          <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
            {hosts.map(h=>(
              <div key={h.id} style={{ flex:1,minWidth:280,background:"var(--color-background-primary)",border:"0.5px solid var(--color-border-tertiary)",borderRadius:10,padding:"10px 14px" }}>
                <div style={{ fontSize:12,fontWeight:500,color:"#27500A",marginBottom:8 }}>{h.label} — pricing</div>
                <div style={{ display:"flex",gap:10,flexWrap:"wrap",alignItems:"center" }}>
                  <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                    <span style={{ fontSize:12,color:"var(--color-text-secondary)" }}>Base</span>
                    <input type="number" value={h.basePrice} min={1} onChange={e=>setHosts(hs=>hs.map(hh=>hh.id!==h.id?hh:{...hh,basePrice:+e.target.value,currentPrice:+e.target.value,declineCount:0}))} style={{ width:64,fontSize:12,padding:"3px 6px",border:"0.5px solid var(--color-border-secondary)",borderRadius:6,background:"var(--color-background-secondary)",color:"var(--color-text-primary)" }}/>
                  </div>
                  <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                    <span style={{ fontSize:12,color:"var(--color-text-secondary)" }}>+% per decline</span>
                    <input type="number" value={h.increaseRate} min={0} max={100} onChange={e=>setHosts(hs=>hs.map(hh=>hh.id!==h.id?hh:{...hh,increaseRate:+e.target.value}))} style={{ width:50,fontSize:12,padding:"3px 6px",border:"0.5px solid var(--color-border-secondary)",borderRadius:6,background:"var(--color-background-secondary)",color:"var(--color-text-primary)" }}/>
                    <span style={{ fontSize:12,color:"var(--color-text-secondary)" }}>%</span>
                  </div>
                  <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                    <span style={{ fontSize:13,fontWeight:500,color:"#27500A" }}>{fmt(h.currentPrice)}</span>
                    {h.declineCount>0&&<span style={{ fontSize:11,color:"#854F0B" }}>↑{h.declineCount} decline{h.declineCount>1?"s":""}</span>}
                    {h.declineCount>0&&<button onClick={()=>resetPrice(h.id)} style={{ fontSize:11,padding:"2px 8px",border:"0.5px solid #888780",borderRadius:5,background:"transparent",cursor:"pointer",color:"var(--color-text-secondary)" }}>Reset</button>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ background:"var(--color-background-primary)",border:"0.5px solid var(--color-border-tertiary)",borderRadius:10,padding:"10px 14px" }}>
            <div style={{ fontSize:12,fontWeight:500,color:"var(--color-text-secondary)",marginBottom:8 }}>GigWorker profiles</div>
            <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
              {workers.map(w=>(
                <div key={w.id} style={{ display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",padding:"6px 10px",background:"var(--color-background-secondary)",borderRadius:8 }}>
                  <div style={{ fontSize:13,fontWeight:500,color:"#791F1F",minWidth:90 }}>{w.label}</div>
                  <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                    <span style={{ fontSize:12,color:"var(--color-text-secondary)" }}>Stars</span>
                    <input type="number" value={w.stars} min={0} max={5} step={0.1} onChange={e=>setWorkers(ws=>ws.map(ww=>ww.id!==w.id?ww:{...ww,stars:Math.min(5,Math.max(0,+e.target.value))}))} style={{ width:52,fontSize:12,padding:"3px 6px",border:"0.5px solid var(--color-border-secondary)",borderRadius:6,background:"var(--color-background-primary)",color:"var(--color-text-primary)" }}/>
                    <span style={{ fontSize:13,color:"#BA7517" }}>{"★".repeat(Math.round(w.stars))}</span>
                  </div>
                  <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                    <span style={{ fontSize:12,color:"var(--color-text-secondary)" }}>Acceptance</span>
                    <input type="number" value={w.acceptance} min={0} max={100} onChange={e=>setWorkers(ws=>ws.map(ww=>ww.id!==w.id?ww:{...ww,acceptance:Math.min(100,Math.max(0,+e.target.value))}))} style={{ width:52,fontSize:12,padding:"3px 6px",border:"0.5px solid var(--color-border-secondary)",borderRadius:6,background:"var(--color-background-primary)",color:"var(--color-text-primary)" }}/>
                    <span style={{ fontSize:12,color:"var(--color-text-secondary)" }}>%</span>
                  </div>
                  <div style={{ fontSize:11,color:"#534AB7",fontWeight:500 }}>
                    Priority score formula: proximity 40% · stars 35% · acceptance 25%
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ marginTop:8,background:"var(--color-background-secondary)",borderRadius:10,border:"0.5px solid var(--color-border-tertiary)",padding:"10px 12px",maxHeight:120,overflowY:"auto" }}>
          <div style={{ fontSize:11,fontWeight:500,color:"var(--color-text-secondary)",marginBottom:4 }}>Event log</div>
          {log.length===0&&<div style={{ fontSize:11,color:"var(--color-text-tertiary)" }}>No events yet.</div>}
          {[...log].reverse().map((l,i)=><div key={i} style={{ fontSize:11,color:logColors[l.type],lineHeight:1.7 }}>{l.msg}</div>)}
        </div>
        <div style={{ marginTop:6,fontSize:11,color:"var(--color-text-tertiary)" }}>Scroll to zoom · Drag canvas to pan · Hover node for actions</div>
      </>}

      {view==="visual"&&(
        <div style={{ background:"var(--color-background-primary)",border:"0.5px solid var(--color-border-tertiary)",borderRadius:12,overflow:"hidden" }}>
          <svg width="100%" viewBox="0 0 640 1020" style={{ display:"block" }}>
            <defs><marker id="ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></marker></defs>
            <rect x="220" y="20" width="200" height="50" rx="8" fill="#EAF3DE" stroke="#3B6D11" strokeWidth="0.8"/><text x="320" y="40" textAnchor="middle" fontSize="13" fontWeight="500" fill="#27500A">GigHost dispatches</text><text x="320" y="57" textAnchor="middle" fontSize="11" fill="#3B6D11">New session · 1:30 timer · base price set</text>
            <line x1="320" y1="70" x2="320" y2="100" stroke="#3B6D11" strokeWidth="1" markerEnd="url(#ar)"/>
            <rect x="210" y="100" width="220" height="50" rx="8" fill="#FAEEDA" stroke="#BA7517" strokeWidth="0.8"/><text x="320" y="120" textAnchor="middle" fontSize="13" fontWeight="500" fill="#633806">Scan every 5 seconds</text><text x="320" y="137" textAnchor="middle" fontSize="11" fill="#854F0B">Find eligible workers in 2km radius</text>
            <line x1="320" y1="150" x2="320" y2="180" stroke="#BA7517" strokeWidth="1" markerEnd="url(#ar)"/>
            <rect x="160" y="180" width="320" height="100" rx="8" fill="#EEEDFE" stroke="#534AB7" strokeWidth="0.8"/><text x="320" y="200" textAnchor="middle" fontSize="12" fontWeight="500" fill="#3C3489">Priority scoring (eligible workers sorted)</text><text x="320" y="218" textAnchor="middle" fontSize="11" fill="#534AB7">Proximity 40% + Star rating 35%</text><text x="320" y="234" textAnchor="middle" fontSize="11" fill="#534AB7">+ Acceptance rate 25% = final score</text><text x="320" y="250" textAnchor="middle" fontSize="11" fill="#7F77DD">Highest score gets the request first</text>
            <line x1="320" y1="280" x2="320" y2="310" stroke="#534AB7" strokeWidth="1" markerEnd="url(#ar)"/>
            <rect x="170" y="310" width="300" height="70" rx="8" fill="#E6F1FB" stroke="#185FA5" strokeWidth="0.8"/><text x="320" y="330" textAnchor="middle" fontSize="12" fontWeight="500" fill="#0C447C">Worker eligibility (all 4 required)</text><text x="320" y="348" textAnchor="middle" fontSize="11" fill="#185FA5">Toggle ON · Inside 2km · No active gig</text><text x="320" y="364" textAnchor="middle" fontSize="11" fill="#185FA5">Not declined this session</text>
            <line x1="320" y1="380" x2="320" y2="420" stroke="#185FA5" strokeWidth="1" markerEnd="url(#ar)"/>
            <rect x="220" y="420" width="200" height="44" rx="8" fill="#EAF3DE" stroke="#3B6D11" strokeWidth="0.8"/><text x="320" y="438" textAnchor="middle" fontSize="12" fontWeight="500" fill="#27500A">Request sent</text><text x="320" y="454" textAnchor="middle" fontSize="11" fill="#3B6D11">Price shown · 30s countdown</text>
            <line x1="320" y1="464" x2="320" y2="510" stroke="#3B6D11" strokeWidth="1" markerEnd="url(#ar)"/>
            <polygon points="320,510 380,536 320,562 260,536" fill="none" stroke="#888780" strokeWidth="0.8"/><text x="320" y="540" textAnchor="middle" fontSize="11" fill="#444441">Worker decides?</text>
            <line x1="380" y1="536" x2="460" y2="536" stroke="#3B6D11" strokeWidth="0.8" markerEnd="url(#ar)"/><text x="418" y="530" textAnchor="middle" fontSize="10" fill="#3B6D11">Accept</text>
            <rect x="448" y="516" width="90" height="44" rx="8" fill="#EAF3DE" stroke="#3B6D11" strokeWidth="0.8"/><text x="493" y="534" textAnchor="middle" fontSize="11" fontWeight="500" fill="#27500A">Gig starts</text><text x="493" y="549" textAnchor="middle" fontSize="10" fill="#3B6D11">On-process</text>
            <line x1="320" y1="562" x2="320" y2="610" stroke="#A32D2D" strokeWidth="0.8" markerEnd="url(#ar)"/><text x="306" y="590" textAnchor="middle" fontSize="10" fill="#A32D2D">Decline</text>
            <rect x="200" y="610" width="240" height="50" rx="8" fill="#FCEBEB" stroke="#A32D2D" strokeWidth="0.8"/><text x="320" y="628" textAnchor="middle" fontSize="12" fontWeight="500" fill="#791F1F">Worker blocked · Price increases</text><text x="320" y="644" textAnchor="middle" fontSize="11" fill="#A32D2D">New price = current × (1 + rate%)</text>
            <path d="M200 635 Q150 635 150 480 Q150 420 220 420" fill="none" stroke="#A32D2D" strokeWidth="0.8" strokeDasharray="4 3" markerEnd="url(#ar)"/>
            <line x1="320" y1="660" x2="320" y2="700" stroke="#A32D2D" strokeWidth="0.8" strokeDasharray="3 3" markerEnd="url(#ar)"/>
            <rect x="180" y="700" width="280" height="44" rx="8" fill="#FCEBEB" stroke="#A32D2D" strokeWidth="0.8"/><text x="320" y="718" textAnchor="middle" fontSize="12" fontWeight="500" fill="#791F1F">Auto-cancel · 3s buffer</text><text x="320" y="734" textAnchor="middle" fontSize="11" fill="#A32D2D">Finalizing session shown to host</text>
            <line x1="320" y1="744" x2="320" y2="774" stroke="#888780" strokeWidth="0.8" markerEnd="url(#ar)"/>
            <rect x="180" y="774" width="280" height="44" rx="8" fill="#EAF3DE" stroke="#3B6D11" strokeWidth="0.8"/><text x="320" y="792" textAnchor="middle" fontSize="12" fontWeight="500" fill="#27500A">Re-dispatch · price carries over</text><text x="320" y="808" textAnchor="middle" fontSize="11" fill="#3B6D11">New session · all blocks cleared</text>
            <line x1="320" y1="818" x2="320" y2="848" stroke="#3B6D11" strokeWidth="0.8" markerEnd="url(#ar)"/>
            <rect x="180" y="848" width="280" height="50" rx="8" fill="#EAF3DE" stroke="#3B6D11" strokeWidth="0.8"/><text x="320" y="866" textAnchor="middle" fontSize="12" fontWeight="500" fill="#27500A">New session starts fresh</text><text x="320" y="882" textAnchor="middle" fontSize="11" fill="#3B6D11">All declined workers eligible again</text>
            <path d="M320 848 Q80 848 80 125 Q80 20 220 20" fill="none" stroke="#3B6D11" strokeWidth="0.8" strokeDasharray="4 3" markerEnd="url(#ar)"/>
          </svg>
        </div>
      )}

      {view==="text"&&(
        <div style={{ background:"var(--color-background-primary)",border:"0.5px solid var(--color-border-tertiary)",borderRadius:12,padding:"16px 20px",lineHeight:1.8,fontSize:13 }}>
          {[
            {title:"1. Dispatch",c:"#3B6D11",bg:"#EAF3DE",items:["GigHost posts a Quick Gig — unique session ID generated.","1 minute 30 second countdown begins.","Dispatch starts at the configured base price.","System scans 2km radius every 5 seconds."]},
            {title:"2. Priority scoring (who gets the request first)",c:"#3C3489",bg:"#EEEDFE",items:["All eligible workers inside the radius are scored before each request.","Score = Proximity 40% + Star rating 35% + Acceptance rate 25%.","Proximity: closer to host = higher score.","The worker with the highest score receives the request first.","If they decline, the next highest score gets it on the next scan."]},
            {title:"3. Worker eligibility (all 4 must be true)",c:"#185FA5",bg:"#E6F1FB",items:["Toggle is ON.","Worker is physically inside the 2km radius.","Worker has no active gig in progress.","Worker has not declined a request from this session."]},
            {title:"4. Request & price",c:"#854F0B",bg:"#FAEEDA",items:["One request is sent to one eligible worker at a time.","The current price is shown to the worker on the request.","Worker receives a 30-second response countdown.","Session extends once if less than 30 seconds remain when request is sent."]},
            {title:"5. Worker decision",c:"#27500A",bg:"#EAF3DE",items:["Accept → gig proceeds at the offered price. Session closes as completed.","Decline → worker blocked for this session. Price increases by the configured rate.","No response in 30 seconds → auto-declined. Price increases. Session ends."]},
            {title:"6. Price increase logic",c:"#633806",bg:"#FAEEDA",items:["Every decline (manual or auto) increases the current price.","New price = current price × (1 + increase rate ÷ 100).","Example: ₱100 base, 10% rate → ₱110 → ₱121 → ₱133.10.","Increase rate is configurable per GigHost.","Host can manually reset the price back to base anytime."]},
            {title:"7. Session end states",c:"#791F1F",bg:"#FCEBEB",items:["Expired / Cancelled → Re-dispatch button appears (same gig, price carries over).","Completed (worker accepted & finished) → Post New Quick Gig button appears (new gig, price resets to base)."]},
          ].map((s,i)=>(
            <div key={i} style={{ marginBottom:16 }}>
              <div style={{ fontSize:13,fontWeight:500,color:s.c,background:s.bg,padding:"5px 10px",borderRadius:6,marginBottom:6,display:"inline-block" }}>{s.title}</div>
              {s.items.map((item,j)=>(
                <div key={j} style={{ display:"flex",gap:8,marginBottom:3 }}>
                  <span style={{ color:"var(--color-text-tertiary)",flexShrink:0 }}>—</span>
                  <span style={{ color:"var(--color-text-primary)" }}>{item}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}