export type Employee = {id:string; name:string; role:string; initials:string; color:string; active:boolean; bio:string; photo?:string; goal?:string};
export type Tip = {id:string; amount:number; allocations:Record<string,number>; rating:number; tags:string[]; comment:string; method:string; date:string; source:'guest'|'seed'; reviewed:boolean};
export type Venue = {name:string;address:string;bill:number;mapUrl?:string};
export type Draft = {layoutVersion:3; visitedAt:string; visitBill?:number; visitMode?:'later'; id:string; amount:string; recipient:string; split:boolean; shares:number[]; servedIds?:string[]; recipientIds?:string[]; splitMode?:'equal'|'custom'; venueSnapshot?:Venue; employeeSnapshots?:Employee[]; rating:number; tags:string[]; comment:string; method:string};
export type Store = {version:1; venue:Venue; employees:Employee[]; tips:Tip[]; withdrawals:{id:string;amount:number;date:string}[]; settings:{shares:number[];recipientIds?:string[]}; profile:{goal:string;target:number;notifications:boolean}};
export const KEY='alfa-tips-demo-v1';
export const MIN_TIP=1000,MAX_TIP=5000000,MAX_TIP_RUB=MAX_TIP/100;
export const defaultMapUrl = (address:string) => 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(address);
export function safeMapUrl(value:string|undefined, address:string):string {
 try {const url=new URL(value||'');if(url.protocol==='https:'||url.protocol==='http:')return url.href}catch{}
 return defaultMapUrl(address);
}
export const employeeDefaults:Record<string,{photo:string;goal:string}> = {
 alex:{photo:'/avatars/alex.jpg',goal:'Путешествие в горы'},
 maria:{photo:'/avatars/maria.jpg',goal:'Курс итальянской кухни'},
 max:{photo:'/avatars/max.jpg',goal:'Поездка к морю'}
};
export function upgradeStore(s:Store):Store {
 let changed=!s.venue.mapUrl;
 const employees=s.employees.map(e=>{const defaults=employeeDefaults[e.id];if(!defaults||e.photo&&e.goal!==undefined)return e;changed=true;return {...e,photo:e.photo||defaults.photo,goal:e.goal??defaults.goal}});
 return changed?{...s,employees,venue:{...s.venue,mapUrl:s.venue.mapUrl||defaultMapUrl(s.venue.address)}}:s;
}
export function employeeGoal(s:Store,e:Employee):string{return e.id==='alex'?s.profile.goal:e.goal||'Цель пока не указана'}

export const coreIds=['alex','maria','max'];
export const tagOptions=['Вкусная еда','Забота','Быстрая подача','Атмосфера','Профессионализм'];
export const money=(v:number)=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',minimumFractionDigits:0,maximumFractionDigits:2}).format(v/100);
export function parseAmount(value:string):number {if(!/^\d{1,5}([.,]\d{1,2})?$/.test(value.trim()))return 0;return Math.round(Number(value.replace(',','.'))*100)}
export function sanitizeTipAmount(value:string):string {const digits=value.replace(/\D/g,'').replace(/^0+(?=\d)/,'').slice(0,5);if(!digits)return '';return String(Math.min(Number(digits),MAX_TIP_RUB))}
export function allocate(amount:number,ids:string[],shares:number[]):Record<string,number>{
 if(!Number.isSafeInteger(amount)||amount<0||ids.length!==shares.length||!ids.length||shares.some(s=>!Number.isFinite(s)||s<0)||Math.abs(shares.reduce((a,b)=>a+b,0)-100)>.001)throw new Error('Доли должны составлять 100%');
 const values=shares.map(s=>Math.floor(amount*s/100));let left=amount-values.reduce((a,b)=>a+b,0);
 const order=shares.map((s,i)=>({i,rest:amount*s/100-values[i]})).sort((a,b)=>b.rest-a.rest);
 for(let i=0;i<left;i++)values[order[i%order.length].i]++;
 return Object.fromEntries(ids.map((id,i)=>[id,values[i]]));
}
// randomUUID requires a secure context; a phone opening the LAN HTTP URL
// only has getRandomValues. Keep UUID v4 IDs on both origins.
export function createId(source: Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>> = globalThis.crypto): string {
 if (typeof source.randomUUID === 'function') return source.randomUUID();
 const bytes = source.getRandomValues(new Uint8Array(16));
 bytes[6] = (bytes[6] & 0x0f) | 0x40;
 bytes[8] = (bytes[8] & 0x3f) | 0x80;
 const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
 return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export const equalShares = (ids=coreIds) => ids.map(() => 100 / ids.length);
export const activeIds = (s:Store) => s.employees.filter(e=>e.active).map(e=>e.id);
export const isEqualSplit = (shares:number[]) => shares.length>0&&shares.every(s=>Math.abs(s-100/shares.length)<.000001);
export const displayedShare = (value:number) => Math.round(value);
export function editShare(shares:number[],index:number,value:number):number[]{
 if(!Number.isInteger(value)||value<0||value>100)return shares;
 if(shares.length===1)return [100];
 const next=shares.map(displayedShare);next[index]=value;
 const others=next.map((_,i)=>i).filter(i=>i!==index),remainder=others.pop()!;
 let available=100-value;
 for(const i of others){next[i]=Math.min(next[i],available);available-=next[i]}
 next[remainder]=available;
 return next;
}
export function prepareDraft(d:Draft,s:Store):Draft {
 const active=activeIds(s),activeSet=new Set(active);
 const requestedServed=Array.isArray(d.servedIds)?d.servedIds.filter(id=>activeSet.has(id)):active.slice(0,3);
 const servedIds=requestedServed.length?Array.from(new Set(requestedServed)):active.slice(0,3);
 const servedSet=new Set(servedIds);
 const recipientIds=Array.isArray(d.recipientIds)?Array.from(new Set(d.recipientIds.filter(id=>servedSet.has(id)))):[...servedIds];
 return {...d,servedIds,recipientIds,shares:equalShares(recipientIds),split:true,splitMode:'equal',recipient:recipientIds[0]||''};
}
export function venueRule(s:Store):{ids:string[];shares:number[]} {
 const ids=activeIds(s),savedIds=s.settings.recipientIds||coreIds;
 const same=ids.length===savedIds.length&&ids.every(id=>savedIds.includes(id));
 return {ids,shares:same?ids.map(id=>s.settings.shares[savedIds.indexOf(id)]):equalShares(ids)};
}
// Approximate presentation only. Allocation and receipts always retain exact kopecks.
export function equalAmountLabel(amount:number,count:number):string {return count>0?(amount%count?'≈ ':'')+money(Math.round(amount/count)):'—'}
export function freshDraft(shares=equalShares()):Draft{return {layoutVersion:3,visitedAt:new Date().toISOString(),id:createId(),amount:'',recipient:'',split:true,shares:[...shares],rating:0,tags:[],comment:'',method:'СБП'}}
export function nextDraftAfterPayment(d:Draft):Draft {const served=[...(d.servedIds||[])];return {...freshDraft(equalShares(served)),visitBill:d.visitBill,servedIds:served,recipientIds:served,recipient:served[0]||'',venueSnapshot:d.venueSnapshot,employeeSnapshots:d.employeeSnapshots}}
// Apply the new default once to old, unpaid drafts without losing amount/review.
export function upgradeDraft(d:Draft):Draft {
 return d.layoutVersion===3?d:{...d,layoutVersion:3,visitedAt:d.visitedAt||new Date().toISOString(),split:true,recipient:'',servedIds:undefined,recipientIds:undefined,shares:equalShares(),splitMode:'equal'};
}

const encodeBase64Url=(text:string)=>{const bytes=new TextEncoder().encode(text);let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')};
const decodeBase64Url=(text:string)=>{const base=text.replaceAll('-','+').replaceAll('_','/');const binary=atob(base+'='.repeat((4-base.length%4)%4));return new TextDecoder().decode(Uint8Array.from(binary,c=>c.charCodeAt(0)))};
export function encodeTipContext(s:Store,d:Draft):string {
 const served=d.servedIds||d.recipientIds||[];const employees=served.map(id=>s.employees.find(e=>e.id===id)).filter((e):e is Employee=>!!e);
 return encodeBase64Url(JSON.stringify({v:1,venue:s.venue,employees,draft:{id:d.id,amount:d.amount,servedIds:served,recipientIds:d.recipientIds||[],rating:d.rating,tags:d.tags,comment:d.comment,method:d.method,visitedAt:d.visitedAt,visitBill:d.visitBill||s.venue.bill}}));
}
export function decodeTipContext(value:string|null):Draft|null {
 try{
  if(!value||value.length>12000)return null;const data=JSON.parse(decodeBase64Url(value));
  if(data?.v!==1||!data.venue||typeof data.venue.name!=='string'||typeof data.venue.address!=='string'||!Number.isSafeInteger(data.venue.bill)||data.venue.bill<=0||data.venue.name.length>80||data.venue.address.length>180||!Array.isArray(data.employees)||data.employees.length>20)return null;
  const employees:Employee[]=data.employees.filter((e:Employee)=>e&&typeof e.id==='string'&&typeof e.name==='string'&&typeof e.role==='string').map((e:Employee)=>({...e,id:e.id.slice(0,80),name:e.name.slice(0,60),role:e.role.slice(0,60),bio:String(e.bio||'').slice(0,300),goal:String(e.goal||'').slice(0,100),photo:typeof e.photo==='string'&&e.photo.startsWith('/avatars/')?e.photo:undefined,active:true}));
  const ids=new Set(employees.map(e=>e.id)),served=(Array.isArray(data.draft?.servedIds)?data.draft.servedIds:[]).filter((id:unknown)=>typeof id==='string'&&ids.has(id));
  const recipients=(Array.isArray(data.draft?.recipientIds)?data.draft.recipientIds:[]).filter((id:unknown)=>typeof id==='string'&&served.includes(id));
  const amount=sanitizeTipAmount(String(data.draft?.amount||''));if(!served.length||!recipients.length||!amount)return null;
  const venue:Venue={name:data.venue.name,address:data.venue.address,bill:data.venue.bill,mapUrl:safeMapUrl(data.venue.mapUrl,data.venue.address)};
  return {...freshDraft(),id:String(data.draft.id||createId()).slice(0,100),amount,servedIds:served,recipientIds:recipients,shares:equalShares(recipients),rating:Number.isInteger(data.draft.rating)&&data.draft.rating>=0&&data.draft.rating<=5?data.draft.rating:0,tags:Array.isArray(data.draft.tags)?data.draft.tags.filter((t:unknown)=>typeof t==='string'&&tagOptions.includes(t)).slice(0,tagOptions.length):[],comment:String(data.draft.comment||'').slice(0,500),method:['СБП','Альфа-Пэй','Карта'].includes(data.draft.method)?data.draft.method:'СБП',visitedAt:Number.isFinite(Date.parse(data.draft.visitedAt))?data.draft.visitedAt:new Date().toISOString(),visitBill:data.draft.visitBill===venue.bill?venue.bill:venue.bill,visitMode:'later',venueSnapshot:venue,employeeSnapshots:employees};
 }catch{return null}
}
export function storeForDraft(base:Store,d:Draft):Store {return d.venueSnapshot&&d.employeeSnapshots?.length?{...base,venue:d.venueSnapshot,employees:d.employeeSnapshots}:base}

export function seed():Store{
 const employees:Employee[]=[{id:'alex',name:'Александр',role:'Официант',initials:'АС',color:'peach',active:true,bio:'Люблю знакомить вас с новыми вкусами. Коплю на путешествие в горы!'},{id:'maria',name:'Мария',role:'Повар',initials:'МВ',color:'sage',active:true,bio:'Готовлю с любовью к деталям.'},{id:'max',name:'Максим',role:'Бармен',initials:'МК',color:'lavender',active:true,bio:'Создаю настроение в каждом бокале.'}];
 const tips:Tip[]=Array.from({length:28},(_,i)=>{const d=new Date();d.setDate(d.getDate()-Math.floor(i/4));d.setHours(12+i%9,12+i%45,0,0); if(i<4)d.setTime(Date.now()-(i+1)*42*60000);const amount=[35000,50000,25000,70000,42000,30000,60000][i%7];return {id:`demo-${i+1}`,amount,allocations:i===2||i===10?{}:i%3===0?allocate(amount,coreIds,[70,20,10]):{[coreIds[i%3]]:amount},rating:i%8===0?4:5,tags:[tagOptions[i%5],tagOptions[(i+2)%5]],comment:['Очень уютно! Александр помог выбрать десерт — всё понравилось.','Прекрасный вечер. Спасибо всей команде!','Паста отличная, но напитки пришлось немного подождать.','Вернёмся к вам снова. Отдельное спасибо за заботу.',''][i%5],method:i%2?'Альфа-Пэй':'СБП',date:d.toISOString(),source:'seed',reviewed:i>5}});
 return upgradeStore({version:1,venue:{name:'Листва',address:'Москва, ул. Покровка, 18/18',bill:350000},employees,tips,withdrawals:[],settings:{shares:[70,20,10]},profile:{goal:'Путешествие в горы',target:5000000,notifications:true}});
}
export function makeTip(draft:Draft,s:Store):Tip{
 const amount=parseAmount(draft.amount);if(amount<MIN_TIP||amount>MAX_TIP)throw new Error('Введите сумму от 10 до 50 000 ₽');
 if(draft.rating<0||draft.rating>5||!Number.isInteger(draft.rating)||draft.comment.length>500)throw new Error('Проверьте отзыв');
 let allocations:Record<string,number>={};
 if(draft.split){const ids=draft.recipientIds||coreIds,known=[...s.employees,...(draft.employeeSnapshots||[])];if(!ids.length||ids.length!==new Set(ids).size||ids.some(id=>!known.find(e=>e.id===id&&e.active)))throw new Error('Выберите хотя бы одного сотрудника.');allocations=allocate(amount,ids,equalShares(ids))}
 else if(draft.recipient!=='pool'){if(!s.employees.find(e=>e.id===draft.recipient&&e.active))throw new Error('Сотрудник недоступен. Выберите другого получателя.');allocations={[draft.recipient]:amount}}
 return {id:draft.id,amount,allocations,rating:draft.rating,tags:draft.tags,comment:draft.comment.trim(),method:draft.method,date:new Date().toISOString(),source:'guest',reviewed:false};
}
export function addTip(s:Store,d:Draft):Store{if(s.tips.some(t=>t.id===d.id))return s;return {...s,tips:[makeTip(d,s),...s.tips]}}
export function balance(s:Store,id='alex'):number{return s.tips.reduce((n,t)=>n+(t.allocations[id]||0),0)-(id==='alex'?s.withdrawals.reduce((n,w)=>n+w.amount,0):0)}
export function withdraw(s:Store,amount:number):Store{if(!Number.isSafeInteger(amount)||amount<=0||amount>balance(s))throw new Error('Недостаточно средств');return {...s,withdrawals:[{id:createId(),amount,date:new Date().toISOString()},...s.withdrawals]}}
export function distributePool(s:Store):Store{const {ids,shares}=venueRule(s);if(!ids.length)throw new Error('Нет активных сотрудников для распределения.');return {...s,tips:s.tips.map(t=>Object.keys(t.allocations).length?t:{...t,allocations:allocate(t.amount,ids,shares)})}}
export function inPeriod(t:Tip,days:number){const date=new Date(t.date);const start=new Date();start.setHours(0,0,0,0);start.setDate(start.getDate()-days+1);return date>=start}
export function csvCell(v:unknown):string{let s=String(v);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'}
