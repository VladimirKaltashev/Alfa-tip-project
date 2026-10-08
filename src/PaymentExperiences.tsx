import {useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import {
  ArrowLeft,ArrowRight,BatteryFull,Bell,Check,CheckCircle2,ChefHat,
  CreditCard,Heart,Home,Martini,Receipt,ScanLine,ShieldCheck,
  Smartphone,UserRound,Wallet,Wifi,Signal
} from 'lucide-react';
import QRCode from 'qrcode';
import {
  activeIds,createId,equalShares,freshDraft,money,parseAmount,
  prepareDraft,sanitizeTipAmount,MIN_TIP,MAX_TIP
} from './model';
import type {Draft,Employee,Store,Tip} from './model';
import {confirmPayment,loadDraft,saveDraft} from './repository';
import './payment-experiences.css';

type Surface='bank'|'gateway'|'web';
type Scenario='bank'|'alfa-card'|'sbp'|'other-card'|'venue';
type RecipientChoice={key:string;label:string;ids:string[];employee?:Employee;icon:'chef'|'bar'|'person'};

const navigate=(path:string)=>{window.location.href=path};

function startVisit(store:Store,scenario:Scenario){
  const servedIds=activeIds(store).slice(0,3);
  const waiter=store.employees.find(e=>servedIds.includes(e.id)&&/официант/i.test(e.role));
  const recipientIds=waiter?[waiter.id]:servedIds.slice(0,1);
  const draft:Draft={
    ...freshDraft(),
    id:createId(),
    visitBill:store.venue.bill,
    servedIds:scenario==='venue'?activeIds(store):servedIds,
    recipientIds,
    recipient:recipientIds[0]||'',
    shares:equalShares(recipientIds),
    method:scenario==='bank'||scenario==='alfa-card'?'Альфа-Пэй':'СБП'
  };
  saveDraft(draft);
  navigate(scenario==='venue'?'/experience/venue/tip':`/experience/${scenario}/paid`);
}

function AlfaMark(){return <span className="xp-alfa-mark" aria-hidden="true">А<span/></span>}

function PhoneFrame({surface,children}: {surface:Surface;children:ReactNode}){
  return <div className={`xp-page xp-${surface}`}>
    <div className="xp-phone">
      {surface==='bank'?<>
        <div className="xp-status"><span>9:41</span><span className="xp-status-icons"><Signal size={15}/><Wifi size={16}/><BatteryFull size={19}/></span></div>
        <div className="xp-bank-header"><a href="/experience" aria-label="К сценариям"><ArrowLeft size={22}/></a><div><AlfaMark/><b>Альфа-Банк</b></div><span className="xp-header-avatar"><UserRound size={19}/></span></div>
      </>:surface==='gateway'?<>
        <div className="xp-gateway-header"><a href="/experience" aria-label="К сценариям"><ArrowLeft size={21}/></a><div><AlfaMark/><b>Альфа-Банк</b></div><ShieldCheck size={20}/></div>
      </>:<>
        <div className="xp-web-header"><a href="/experience" aria-label="К сценариям"><ArrowLeft size={21}/></a><div><AlfaMark/><b>чаевые</b></div><span className="xp-web-menu">•••</span></div>
      </>}
      <div className="xp-phone-content">{children}</div>
      {surface==='bank'&&<div className="xp-bank-tabbar"><span><Home size={21}/><small>Главная</small></span><span><Wallet size={21}/><small>Платежи</small></span><span><Receipt size={21}/><small>История</small></span></div>}
    </div>
  </div>;
}

function DemoIndex({store}:{store:Store}){
  const cards:{id:Scenario;icon:ReactNode;title:string;meta:string}[]=[
    {id:'bank',icon:<Smartphone/>,title:'Приложение Альфы',meta:'Оплата в приложении'},
    {id:'alfa-card',icon:<Bell/>,title:'Карта Альфы',meta:'Терминал · уведомление · QR'},
    {id:'sbp',icon:<ScanLine/>,title:'СБП другого банка',meta:'Страница оплаты'},
    {id:'other-card',icon:<CreditCard/>,title:'Карта другого банка',meta:'Терминал · QR чека'},
    {id:'venue',icon:<Heart/>,title:'Общий QR заведения',meta:'Выбор команды'}
  ];
  return <main className="xp-demo">
    <div className="xp-demo-inner">
      <div className="xp-demo-brand"><AlfaMark/><span>чаевые</span></div>
      <span className="xp-demo-kicker">СЦЕНАРИИ ОПЛАТЫ</span>
      <h1>От счёта<br/>до спасибо</h1>
      <div className="xp-demo-grid">{cards.map(card=><button key={card.id} className="xp-demo-card" onClick={()=>card.id==='venue'?startVisit(store,'venue'):navigate(`/experience/${card.id}/pay`)}>
        <span className="xp-demo-card-icon">{card.icon}</span>
        <span className="xp-demo-card-body"><b>{card.title}</b><small>{card.meta}</small></span>
        <ArrowRight size={21}/>
      </button>)}</div>
      <a className="xp-demo-existing" href="/">Открыть текущую страницу чаевых <ArrowRight size={17}/></a>
    </div>
  </main>;
}

function BillPayment({store,surface,scenario}:{store:Store;surface:Surface;scenario:Scenario}){
  if(surface==='bank')return <PhoneFrame surface="bank"><div className="xp-bank-bill">
    <span className="xp-overline">ОПЛАТА СЧЁТА</span>
    <div className="xp-bank-merchant"><span className="xp-merchant-symbol">Л</span><div><b>{store.venue.name}</b><small>Ресторан · Москва</small></div></div>
    <div className="xp-bill-amount">{money(store.venue.bill)}</div>
    <div className="xp-bank-method"><span className="xp-method-card"><AlfaMark/></span><span><b>Карта Альфы</b><small>•• 4242</small></span><Check size={18}/></div>
    <button className="xp-button" onClick={()=>startVisit(store,scenario)}>Оплатить {money(store.venue.bill)} <ArrowRight size={20}/></button>
  </div></PhoneFrame>;
  if(surface==='gateway')return <PhoneFrame surface="gateway"><div className="xp-gateway-bill">
    <span className="xp-overline">БЕЗОПАСНАЯ ОПЛАТА</span>
    <h1>Оплата счёта</h1>
    <div className="xp-gateway-order"><span className="xp-merchant-symbol">Л</span><div><b>{store.venue.name}</b><small>Счёт № 1048</small></div></div>
    <div className="xp-gateway-total"><span>К оплате</span><b>{money(store.venue.bill)}</b></div>
    <div className="xp-sbp-sign"><span className="xp-sbp-symbol">➤</span><b>СБП</b><CheckCircle2 size={20}/></div>
    <button className="xp-button" onClick={()=>startVisit(store,scenario)}>Оплатить через СБП <ArrowRight size={20}/></button>
  </div></PhoneFrame>;
  return <TerminalPayment store={store} scenario={scenario}/>;
}

function BillPaid({store,surface,scenario,tip}:{store:Store;surface:Surface;scenario:Scenario;tip?:Tip}){
  const tipPath=scenario==='bank'?'/experience/bank/tip':'/experience/sbp/tip';
  const successPath=scenario==='bank'?'/experience/bank/success/'+tip?.id:'/experience/sbp/success/'+tip?.id;
  if(surface==='bank')return <PhoneFrame surface="bank"><div className="xp-paid xp-bank-paid">
    <div className="xp-paid-check"><Check size={46} strokeWidth={3}/></div>
    <span className="xp-overline">ПЛАТЁЖ ВЫПОЛНЕН</span>
    <h1>Оплачено</h1>
    <strong>{money(store.venue.bill)}</strong>
    <p>{store.venue.name}</p>
    <button className="xp-button xp-paid-cta" onClick={()=>navigate(tip?successPath:tipPath)}>{tip?'Посмотреть чаевые':'Оставить чаевые'} <Heart size={21}/></button>
    {!tip&&<button className="xp-quiet-action" onClick={()=>navigate('/experience')}>Готово</button>}
  </div></PhoneFrame>;
  return <PhoneFrame surface="gateway"><div className="xp-paid xp-gateway-paid">
    <div className="xp-paid-check"><Check size={43} strokeWidth={3}/></div>
    <h1>Счёт оплачен</h1>
    <strong>{money(store.venue.bill)}</strong>
    <p>{store.venue.name}</p>
    <div className="xp-tip-invite"><span><Heart size={31}/></span><h2>{tip?'Спасибо уже отправлено':'Оставить чаевые?'}</h2><button className="xp-button" onClick={()=>navigate(tip?successPath:tipPath)}>{tip?'Посмотреть':'Оставить чаевые'} <ArrowRight size={20}/></button></div>
    {!tip&&<button className="xp-quiet-action" onClick={()=>navigate('/experience')}>Нет, спасибо</button>}
  </div></PhoneFrame>;
}

function QrImage({url}:{url:string}){
  const [src,setSrc]=useState('');
  useEffect(()=>{QRCode.toDataURL(location.origin+url,{width:210,margin:1,color:{dark:'#24252b',light:'#ffffff'}}).then(setSrc).catch(()=>setSrc(''))},[url]);
  return src?<img className="xp-qr-image" src={src} alt="QR-код чаевых"/>:<ScanLine className="xp-qr-fallback" size={86}/>;
}

function TerminalPayment({store,scenario,paid=false,tip}:{store:Store;scenario:Scenario;paid?:boolean;tip?:Tip}){
  const alfa=scenario==='alfa-card';
  const target=alfa?'/experience/bank/tip':'/experience/web/tip';
  const success=alfa?'/experience/bank/success/'+tip?.id:'/experience/web/success/'+tip?.id;
  return <main className={`xp-terminal-page ${paid?'xp-terminal-paid':''}`}><div className="xp-terminal-inner">
    <a className="xp-terminal-back" href="/experience"><ArrowLeft size={18}/> Сценарии</a>
    <div className="xp-terminal-columns">
      <section className="xp-terminal-panel">
        <span className="xp-overline">ТЕРМИНАЛ</span>
        <div className="xp-terminal-display"><span className="xp-merchant-symbol">Л</span><h1>{store.venue.name}</h1><small>К оплате</small><strong>{money(store.venue.bill)}</strong>{paid?<div className="xp-terminal-done"><CheckCircle2 size={20}/> Оплачено</div>:<button className="xp-button" onClick={()=>startVisit(store,scenario)}>Оплатить картой <CreditCard size={20}/></button>}</div>
      </section>
      <section className="xp-terminal-result">
        {paid?<><div className="xp-paper-receipt"><div className="xp-receipt-brand">ЛИСТВА</div><span>Кассовый чек · № 1048</span><div className="xp-receipt-row"><span>Итого</span><b>{money(store.venue.bill)}</b></div><div className="xp-receipt-divider"/><h2>Чаевые</h2><QrImage url={target}/><small>Отсканируйте QR-код</small></div>
          {alfa&&<button className="xp-push" onClick={()=>navigate(tip?success:target)}><span className="xp-push-icon"><AlfaMark/></span><span><small>АЛЬФА-БАНК · СЕЙЧАС</small><b>{tip?'Чаевые отправлены':'Счёт оплачен. Оставить чаевые?'}</b></span><ArrowRight size={18}/></button>}
          <button className="xp-terminal-scan" onClick={()=>navigate(tip?success:target)}><ScanLine size={20}/>{tip?'Посмотреть чаевые':'Открыть QR чека'}<ArrowRight size={18}/></button>
        </>:<div className="xp-terminal-placeholder"><Receipt size={52}/><h2>Чек появится после оплаты</h2></div>}
      </section>
    </div>
  </div></main>;
}

function recipientChoices(store:Store,draft:Draft):RecipientChoice[]{
  const served=new Set(draft.servedIds||activeIds(store));
  const employees=store.employees.filter(e=>e.active&&served.has(e.id));
  const waiters=employees.filter(e=>/официант/i.test(e.role));
  const kitchen=employees.filter(e=>/повар|кух|шеф/i.test(e.role));
  const bar=employees.filter(e=>/бармен|бариста|бар/i.test(e.role));
  const grouped=new Set([...waiters,...kitchen,...bar].map(e=>e.id));
  const choices:RecipientChoice[]=waiters.map(e=>({key:e.id,label:e.name,ids:[e.id],employee:e,icon:'person'}));
  if(kitchen.length)choices.push({key:'kitchen',label:'Кухня',ids:kitchen.map(e=>e.id),icon:'chef'});
  if(bar.length)choices.push({key:'bar',label:'Бар',ids:bar.map(e=>e.id),icon:'bar'});
  for(const e of employees.filter(e=>!grouped.has(e.id)))choices.push({key:e.id,label:e.name,ids:[e.id],employee:e,icon:'person'});
  return choices;
}

function RecipientIcon({choice}:{choice:RecipientChoice}){
  if(choice.employee?.photo)return <img src={choice.employee.photo} alt="" className="xp-recipient-photo"/>;
  if(choice.icon==='chef')return <ChefHat size={38} strokeWidth={1.7}/>;
  if(choice.icon==='bar')return <Martini size={38} strokeWidth={1.7}/>;
  return <UserRound size={38} strokeWidth={1.7}/>;
}

function TipForm({store,surface,scenario,tip}:{store:Store;surface:Surface;scenario:Scenario;tip?:Tip}){
  const [draft,setDraft]=useState<Draft>(()=>prepareDraft(loadDraft(),store));
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const d=prepareDraft(draft,store);
  const amount=parseAmount(d.amount);
  const options=recipientChoices(store,d);
  const selected=new Set(d.recipientIds||[]);
  const generic=scenario==='venue';
  const methods=surface==='bank'?[{value:'Альфа-Пэй',label:'Карта Альфы',icon:<AlfaMark/>},{value:'СБП',label:'СБП',icon:<span className="xp-sbp-symbol">➤</span>}]:surface==='gateway'?[{value:'СБП',label:'СБП',icon:<span className="xp-sbp-symbol">➤</span>},{value:'Карта',label:'Карта',icon:<CreditCard size={22}/>}]:[{value:'СБП',label:'СБП',icon:<span className="xp-sbp-symbol">➤</span>},{value:'Карта',label:'Карта',icon:<CreditCard size={22}/>},{value:'Альфа-Пэй',label:'Альфа',icon:<AlfaMark/>}];
  function patch(part:Partial<Draft>){const next={...d,...part};setDraft(next);saveDraft(next);setError('')}
  function toggle(choice:RecipientChoice){const next=choice.ids.every(id=>selected.has(id))?(d.recipientIds||[]).filter(id=>!choice.ids.includes(id)):Array.from(new Set([...(d.recipientIds||[]),...choice.ids]));patch({recipientIds:next,recipient:next[0]||'',shares:equalShares(next)})}
  async function pay(){
    if(busy)return;
    if(amount<MIN_TIP||amount>MAX_TIP){setError('Укажите сумму от 10 до 50 000 ₽');return}
    if(!d.recipientIds?.length){setError('Выберите получателя');return}
    setBusy(true);setError('');
    try{
      saveDraft(d);
      const result=await confirmPayment(d);
      navigate(`/experience/${scenario==='alfa-card'?'bank':scenario==='other-card'?'web':scenario}/success/${result.id}`);
    }catch(e){setError(e instanceof Error?e.message:'Не удалось оплатить чаевые');setBusy(false)}
  }
  if(tip)return <TipSuccess store={store} surface={surface} tip={tip}/>;
  return <PhoneFrame surface={surface}><div className="xp-tip-form">
    <div className="xp-tip-top"><h1>Оставить чаевые</h1><div className="xp-tip-venue"><span className="xp-merchant-symbol">Л</span><b>{store.venue.name}</b>{!generic&&<small>Счёт {money(d.visitBill||store.venue.bill)}</small>}</div></div>
    <div className="xp-tip-section"><h2>Сумма</h2><div className="xp-tip-amount"><input aria-label="Сумма чаевых" inputMode="numeric" placeholder="0" value={d.amount} onChange={e=>patch({amount:sanitizeTipAmount(e.target.value)})}/><span>₽</span></div><div className="xp-tip-presets">{(generic?[100,300,500]:[5,10,15]).map(n=>{const value=generic?n*100:Math.round((d.visitBill||store.venue.bill)*n/100);return <button key={n} className={amount===value?'selected':''} onClick={()=>patch({amount:String(value/100)})}>{generic?money(value):`${n}%`}</button>})}</div></div>
    <div className="xp-tip-section"><h2>Кому</h2><div className="xp-recipient-grid">{options.map(choice=>{const on=choice.ids.every(id=>selected.has(id));return <button key={choice.key} aria-pressed={on} className={`xp-recipient ${on?'selected':''}`} onClick={()=>toggle(choice)}><span className="xp-recipient-symbol"><RecipientIcon choice={choice}/></span><b>{choice.label}</b><span className="xp-recipient-check">{on&&<Check size={16}/>}</span></button>})}</div></div>
    <div className="xp-tip-section xp-method-section"><h2>Оплатить через</h2><div className="xp-method-grid">{methods.map(method=><button key={method.value} aria-pressed={d.method===method.value} className={d.method===method.value?'selected':''} onClick={()=>patch({method:method.value})}><span>{method.icon}</span><b>{method.label}</b>{d.method===method.value&&<Check size={16}/>}</button>)}</div></div>
    {error&&<p className="xp-error" role="alert">{error}</p>}
    <button className="xp-button xp-tip-submit" disabled={busy} onClick={pay}>{busy?'Отправляем…':`Оставить ${amount?money(amount):'чаевые'}`} <Heart size={21}/></button>
  </div></PhoneFrame>;
}

function TipSuccess({store,surface,tip}:{store:Store;surface:Surface;tip:Tip}){
  return <PhoneFrame surface={surface}><div className="xp-paid xp-tip-success"><div className="xp-paid-check"><Check size={45} strokeWidth={3}/></div><h1>Чаевые отправлены</h1><strong>{money(tip.amount)}</strong><p>{store.venue.name}</p><div className="xp-success-people"><Heart size={23}/><span>{Object.keys(tip.allocations).map(id=>store.employees.find(e=>e.id===id)?.name).filter(Boolean).join(', ')}</span></div><a className="xp-button" href="/experience">К сценариям <ArrowRight size={20}/></a></div></PhoneFrame>;
}

export function PaymentExperiences({store}:{store:Store}){
  const [,scenario='',stage='',id]=location.pathname.split('/').filter(Boolean);
  if(!scenario)return <DemoIndex store={store}/>;
  const draft=loadDraft();
  const tip=store.tips.find(t=>t.id===draft.id);
  const surface:Surface=scenario==='bank'||scenario==='alfa-card'?'bank':scenario==='sbp'?'gateway':'web';
  if(stage==='success'){
    const completed=store.tips.find(t=>t.id===id);
    return completed?<TipSuccess store={store} surface={surface} tip={completed}/>:<DemoIndex store={store}/>;
  }
  if(scenario==='bank'||scenario==='sbp'){
    if(stage==='pay')return <BillPayment store={store} surface={surface} scenario={scenario as Scenario}/>;
    if(stage==='paid')return <BillPaid store={store} surface={surface} scenario={scenario as Scenario} tip={tip}/>;
    if(stage==='tip')return <TipForm store={store} surface={surface} scenario={scenario as Scenario} tip={tip}/>;
  }
  if(scenario==='alfa-card'||scenario==='other-card'){
    if(stage==='pay'||stage==='paid')return <TerminalPayment store={store} scenario={scenario as Scenario} paid={stage==='paid'} tip={tip}/>;
  }
  if((scenario==='web'||scenario==='venue')&&stage==='tip')return <TipForm store={store} surface="web" scenario={scenario as Scenario} tip={tip}/>;
  return <DemoIndex store={store}/>;
}
