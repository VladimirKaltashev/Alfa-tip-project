import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareDraft,venueRule,equalAmountLabel,upgradeStore,safeMapUrl,employeeGoal,upgradeDraft,createId,allocate,parseAmount,sanitizeTipAmount,encodeTipContext,decodeTipContext,storeForDraft,nextDraftAfterPayment,seed,freshDraft,addTip,balance,withdraw,distributePool,csvCell} from '../src/model.ts';
test('custom amounts use integer kopecks and reject malformed values',()=>{assert.equal(parseAmount('125,55'),12555);assert.equal(parseAmount('175.5'),17550);for(const s of ['-20','NaN','Infinity','10e3','10.001','hello',''])assert.equal(parseAmount(s),0)});
test('tip input keeps digits only and caps at fifty thousand rubles',()=>{assert.equal(sanitizeTipAmount('влдаоф-100'),'100');assert.equal(sanitizeTipAmount('12 345'),'12345');assert.equal(sanitizeTipAmount('9999999'),'50000');assert.equal(sanitizeTipAmount('-'),'')});
test('split conserves every kopeck for uneven amounts',()=>{for(const amount of [1001,10000,34999,5000000]){const a=allocate(amount,['a','b','c'],[34,33,33]);assert.equal(Object.values(a).reduce((n,x)=>n+x,0),amount);assert.ok(Object.values(a).every(Number.isSafeInteger))}});
test('zero share receives nothing',()=>assert.deepEqual(allocate(1001,['a','b','c'],[0,0,100]),{a:0,b:0,c:1001}));
test('invalid distributions are rejected',()=>{for(const shares of [[50,20,10],[-1,50,51],[NaN,0,100],[Infinity,0,0]])assert.throws(()=>allocate(1000,['a','b','c'],shares));assert.throws(()=>allocate(1000,['a'],[50,50]))});
test('tips are never preselected',()=>assert.equal(freshDraft().amount,''));
test('double confirmation creates one transaction',()=>{const s=seed();const d={...freshDraft(),amount:'350',split:false,recipient:'alex',comment:'Спасибо!',rating:5};const once=addTip(s,d),twice=addTip(once,d);assert.equal(twice.tips.length,s.tips.length+1);assert.equal(balance(twice)-balance(s),35000)});
test('a completed payment creates a clean draft and the next tip is a new transaction',()=>{const base=seed(),first={...prepareDraft(freshDraft(),base),amount:'350',comment:'Первый отзыв',rating:5},paid=addTip(base,first),next=nextDraftAfterPayment(first);assert.notEqual(next.id,first.id);assert.equal(next.amount,'');assert.equal(next.comment,'');assert.equal(next.rating,0);const second={...next,amount:'400',comment:'Второй отзыв'},paidAgain=addTip(paid,second);assert.equal(paidAgain.tips.length,base.tips.length+2);assert.equal(paidAgain.tips[0].amount,40000);assert.equal(paidAgain.tips[0].comment,'Второй отзыв');assert.equal(paidAgain.tips[1].amount,35000)});
test('selected receipt employees share the tip equally',()=>{const s=seed(),d={...freshDraft(),amount:'350.01',servedIds:['alex','maria'],recipientIds:['alex','maria']};const n=addTip(s,d),values=Object.values(n.tips[0].allocations);assert.equal(balance(n)-balance(s),17501);assert.deepEqual(Object.keys(n.tips[0].allocations),['alex','maria']);assert.equal(values.reduce((a,b)=>a+b,0),35001);assert.ok(Math.max(...values)-Math.min(...values)<=1)});
test('out of range and invalid input never creates a payment',()=>{for(const amount of ['9.99','50000.01','bad','0'])assert.throws(()=>addTip(seed(),{...freshDraft(),amount}))});
test('paused employees cannot receive new tips',()=>{const s=seed();s.employees[0].active=false;assert.throws(()=>addTip(s,{...freshDraft(),amount:'200'}));assert.throws(()=>addTip(s,{...freshDraft(),amount:'200',split:true}))});
test('unassigned tips do not reach employee until manager distribution',()=>{const base=seed();base.tips=base.tips.filter(t=>Object.keys(t.allocations).length);const s=addTip(base,{...freshDraft(),recipient:'pool',split:false,amount:'1000'});assert.equal(balance(s),balance(base));const n=distributePool(s);assert.equal(balance(n)-balance(s),70000);assert.equal(n.tips.reduce((sum,t)=>sum+t.amount,0),s.tips.reduce((sum,t)=>sum+t.amount,0));assert.deepEqual(distributePool(n),n)});
test('withdrawal reduces only available balance and prevents overdraft',()=>{const s=seed(),available=balance(s),n=withdraw(s,available);assert.equal(balance(n),0);assert.equal(n.tips.length,s.tips.length);assert.throws(()=>withdraw(n,1));assert.throws(()=>withdraw(s,-1));assert.throws(()=>withdraw(s,NaN))});
test('withdrawals belong to the selected employee profile',()=>{const s=seed(),alex=balance(s,'alex'),maria=balance(s,'maria'),n=withdraw(s,maria,'maria');assert.equal(balance(n,'maria'),0);assert.equal(balance(n,'alex'),alex);assert.equal(n.withdrawals[0].employeeId,'maria')});
test('ratings and comments survive transfer',()=>{const d={...freshDraft(),amount:'100',rating:4,tags:['Забота'],comment:'  Прекрасный вечер  '};const n=addTip(seed(),d);assert.equal(n.tips[0].comment,'Прекрасный вечер');assert.deepEqual(n.tips[0].tags,['Забота']);assert.equal(n.tips[0].rating,4)});
test('CSV neutralizes spreadsheet formulas and escapes quotes',()=>{assert.equal(csvCell('=HYPERLINK("x")'),'"\'=HYPERLINK(""x"")"');assert.equal(csvCell('Привет'),'"Привет"')});

// Regression: LAN HTTP on Safari/Chromium has no crypto.randomUUID.
test('HTTP fallback creates distinct UUID v4 IDs', () => {
 const httpCrypto = {getRandomValues: crypto.getRandomValues.bind(crypto)};
 const ids = Array.from({length: 1000}, () => createId(httpCrypto));
 assert.equal(new Set(ids).size, ids.length);
 for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
test('draft, payment and withdrawal work without randomUUID', () => {
 const descriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
 Object.defineProperty(crypto, 'randomUUID', {value: undefined, configurable: true});
 try {
  const s = seed();
  const d = {...freshDraft(), amount: '100', split: true};
  const paid = addTip(s, d);
  assert.equal(balance(paid) - balance(s), 3334);
  assert.equal(addTip(paid, d).tips.length, paid.tips.length);
  const result = withdraw(paid, 3334);
  assert.equal(balance(result), balance(s));
  assert.notEqual(result.withdrawals[0].id, d.id);
 } finally {
  if (descriptor) Object.defineProperty(crypto, 'randomUUID', descriptor);
  else Reflect.deleteProperty(crypto, 'randomUUID');
 }
});

test('a fresh guest draft splits equally without preselecting an employee',()=>{
 const d=freshDraft();assert.equal(d.split,true);assert.equal(d.recipient,'');assert.equal(d.amount,'');
 for(const amount of ['300','350','350.01','10']){
  const t=addTip(seed(),{...d,amount}).tips[0];const values=Object.values(t.allocations);
  assert.equal(values.reduce((a,b)=>a+b,0),parseAmount(amount));
  assert.ok(Math.max(...values)-Math.min(...values)<=1);
 }
});
test('old draft adopts equal split once and keeps amount, review and ID',()=>{
 const old={...freshDraft(),layoutVersion:undefined,split:false,recipient:'max',shares:[70,20,10],amount:'175',comment:'Спасибо'};
 const migrated=upgradeDraft(old);assert.equal(migrated.split,true);assert.equal(migrated.amount,'175');assert.equal(migrated.comment,'Спасибо');assert.equal(migrated.id,old.id);
 const choice={...migrated,split:false,recipient:'maria'};assert.deepEqual(upgradeDraft(choice),choice);
});


test('store upgrade adds portraits, goals and map without losing saved data',()=>{
 const old=seed();delete old.venue.mapUrl;
 old.employees=old.employees.map(({photo,goal,...employee})=>employee);
 old.profile.goal='Моя новая цель';
 const updated=upgradeStore(old);
 assert.equal(updated.tips,old.tips);assert.equal(updated.withdrawals,old.withdrawals);
 assert.equal(updated.settings,old.settings);assert.equal(updated.profile,old.profile);
 assert.ok(updated.employees.every(e=>e.photo&&e.goal));
 assert.equal(employeeGoal(updated,updated.employees[0]),'Моя новая цель');
 updated.venue.mapUrl='https://maps.example.com/custom';
 updated.employees[1].photo='/custom.jpg';updated.employees[1].goal='Собственная цель';
 assert.equal(upgradeStore(updated),updated);
});
test('map link respects configured web URL and rejects non-web schemes',()=>{
 const address='Москва, Покровка, 18/18';
 assert.equal(safeMapUrl('https://maps.example.com/place?id=1',address),'https://maps.example.com/place?id=1');
 for(const value of [undefined,'','javascript:alert(1)','data:text/html,test','not a URL']){
  const url=new URL(safeMapUrl(value,address));assert.equal(url.hostname,'www.google.com');assert.equal(url.searchParams.get('query'),address);
 }
});


test('guest choices always normalize to equal shares',()=>{const s=seed(),d=prepareDraft({...freshDraft(),servedIds:['alex','max'],recipientIds:['alex','max'],shares:[90,10],splitMode:'custom'},s);assert.deepEqual(d.recipientIds,['alex','max']);assert.deepEqual(d.shares,[50,50]);assert.equal(d.splitMode,'equal');assert.deepEqual(addTip(s,{...d,amount:'175'}).tips[0].allocations,{alex:8750,max:8750})});
test('equal labels are approximate while exact allocations conserve money',()=>{
 assert.match(equalAmountLabel(17500,3),/^≈ /);
 assert.doesNotMatch(equalAmountLabel(30000,3),/^≈ /);
 const d=prepareDraft({...freshDraft(),amount:'175'},seed());
 const values=Object.values(addTip(seed(),d).tips[0].allocations);
 assert.equal(values.reduce((a,b)=>a+b,0),17500);
 assert.equal(Math.max(...values)-Math.min(...values),1);
});
test('team can have two cooks, one multi-role employee or more than three people',()=>{
 for(const count of [1,2,4,7]){
  const s=seed();s.employees=Array.from({length:count},(_,i)=>({...s.employees[0],id:'person-'+i,name:'Сотрудник '+i,role:count===1?'Официант и бармен':'Повар'}));
  const d=prepareDraft({...freshDraft(),amount:'350'},s);
  assert.equal(d.recipient,'person-0');assert.equal(d.split,true);assert.equal(d.servedIds?.length,Math.min(count,3));
  const all=s.employees.map(e=>e.id),configured=prepareDraft({...d,servedIds:all,recipientIds:all},s);
  const tip=addTip(s,configured).tips[0];assert.equal(Object.keys(tip.allocations).length,count);
  assert.equal(Object.values(tip.allocations).reduce((a,b)=>a+b,0),35000);
  assert.equal(venueRule(s).ids.length,count);
  const distributed=distributePool(s);assert.ok(distributed.tips.every(t=>Object.keys(t.allocations).length>0));
 }
});
test('reordering venue staff preserves the employees attached to the receipt',()=>{
 const s=seed(),d=prepareDraft(freshDraft(),s);
 s.employees.reverse();const next=prepareDraft(d,s);
 assert.deepEqual(next.recipientIds,['alex','maria','max']);assert.deepEqual(next.shares,[100/3,100/3,100/3]);
 assert.deepEqual(venueRule(s).shares,[10,20,70]);
});
test('paused recipients disappear and stale payments are rejected',()=>{
 const s=seed(),d=prepareDraft({...freshDraft(),amount:'100'},s);s.employees[0].active=false;
 assert.throws(()=>addTip(s,d));
 const next=prepareDraft(d,s);assert.deepEqual(next.recipientIds,['maria','max']);assert.deepEqual(next.shares,[50,50]);
 assert.equal(next.recipient,'maria');assert.equal(addTip(s,next).tips[0].allocations.alex,undefined);
});
test('an empty receipt team cannot receive a guest tip',()=>{
 const s=seed();s.employees=[];const d=prepareDraft({...freshDraft(),amount:'100'},s);
 assert.equal(d.split,true);assert.equal(d.recipient,'');assert.throws(()=>addTip(s,d));
 assert.throws(()=>distributePool(s));
});
test('a postponed link carries venue, amount and selected recipients to another device',()=>{const s=seed(),d=prepareDraft({...freshDraft(),amount:'499',servedIds:['alex','maria'],recipientIds:['maria'],rating:5,tags:['Забота'],comment:'Спасибо'},s);const restored=decodeTipContext(encodeTipContext(s,d));assert.ok(restored);assert.equal(restored.amount,'499');assert.deepEqual(restored.servedIds,['alex','maria']);assert.deepEqual(restored.recipientIds,['maria']);assert.equal(restored.venueSnapshot?.name,s.venue.name);assert.deepEqual(storeForDraft({...seed(),venue:{...seed().venue,name:'Другое место'}},restored).employees.map(e=>e.id),['alex','maria'])});
test('ordinary saved drafts use the live manager team',()=>{const s=seed(),snapshot={...freshDraft(),venueSnapshot:s.venue,employeeSnapshots:s.employees.slice(0,2)},live={...s,employees:[...s.employees,{...s.employees[0],id:'new',name:'Новый сотрудник'}]};assert.equal(storeForDraft(live,snapshot),live);assert.equal(storeForDraft(live,{...snapshot,snapshotLocked:true}).employees.length,2)});
