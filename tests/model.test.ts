import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareDraft,venueRule,editShare,displayedShare,isEqualSplit,equalAmountLabel,upgradeStore,safeMapUrl,employeeGoal,upgradeDraft,createId,allocate,parseAmount,seed,freshDraft,addTip,balance,withdraw,distributePool,csvCell} from '../src/model.ts';
test('custom amounts use integer kopecks and reject malformed values',()=>{assert.equal(parseAmount('125,55'),12555);assert.equal(parseAmount('175.5'),17550);for(const s of ['-20','NaN','Infinity','10e3','10.001','hello',''])assert.equal(parseAmount(s),0)});
test('split conserves every kopeck for uneven amounts',()=>{for(const amount of [1001,10000,34999,5000000]){const a=allocate(amount,['a','b','c'],[34,33,33]);assert.equal(Object.values(a).reduce((n,x)=>n+x,0),amount);assert.ok(Object.values(a).every(Number.isSafeInteger))}});
test('zero share receives nothing',()=>assert.deepEqual(allocate(1001,['a','b','c'],[0,0,100]),{a:0,b:0,c:1001}));
test('invalid distributions are rejected',()=>{for(const shares of [[50,20,10],[-1,50,51],[NaN,0,100],[Infinity,0,0]])assert.throws(()=>allocate(1000,['a','b','c'],shares));assert.throws(()=>allocate(1000,['a'],[50,50]))});
test('tips are never preselected',()=>assert.equal(freshDraft().amount,''));
test('double confirmation creates one transaction',()=>{const s=seed();const d={...freshDraft(),amount:'350',split:false,recipient:'alex',comment:'Спасибо!',rating:5};const once=addTip(s,d),twice=addTip(once,d);assert.equal(twice.tips.length,s.tips.length+1);assert.equal(balance(twice)-balance(s),35000)});
test('guest split is reflected in recipient totals',()=>{const s=seed(),d={...freshDraft(),amount:'350.01',split:true,shares:[70,20,10]};const n=addTip(s,d);assert.equal(balance(n)-balance(s),24501);assert.equal(n.tips[0].allocations.maria,7000);assert.equal(n.tips[0].allocations.max,3500)});
test('out of range and invalid input never creates a payment',()=>{for(const amount of ['9.99','50000.01','bad','0'])assert.throws(()=>addTip(seed(),{...freshDraft(),amount}))});
test('paused employees cannot receive new tips',()=>{const s=seed();s.employees[0].active=false;assert.throws(()=>addTip(s,{...freshDraft(),amount:'200'}));assert.throws(()=>addTip(s,{...freshDraft(),amount:'200',split:true}))});
test('unassigned tips do not reach employee until manager distribution',()=>{const base=seed();base.tips=base.tips.filter(t=>Object.keys(t.allocations).length);const s=addTip(base,{...freshDraft(),recipient:'pool',split:false,amount:'1000'});assert.equal(balance(s),balance(base));const n=distributePool(s);assert.equal(balance(n)-balance(s),70000);assert.equal(n.tips.reduce((sum,t)=>sum+t.amount,0),s.tips.reduce((sum,t)=>sum+t.amount,0));assert.deepEqual(distributePool(n),n)});
test('withdrawal reduces only available balance and prevents overdraft',()=>{const s=seed(),available=balance(s),n=withdraw(s,available);assert.equal(balance(n),0);assert.equal(n.tips.length,s.tips.length);assert.throws(()=>withdraw(n,1));assert.throws(()=>withdraw(s,-1));assert.throws(()=>withdraw(s,NaN))});
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
  const d = {...freshDraft(), amount: '100', split: true, shares:[70,20,10]};
  const paid = addTip(s, d);
  assert.equal(balance(paid) - balance(s), 7000);
  assert.equal(addTip(paid, d).tips.length, paid.tips.length);
  const result = withdraw(paid, 7000);
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


test('opening custom shares preserves equal amounts until the first edit',()=>{
 const s=seed(),d=prepareDraft({...freshDraft(),amount:'175'},s);
 const custom={...d,splitMode:'custom'};
 assert.deepEqual(custom.shares.map(displayedShare),[33,33,33]);
 assert.deepEqual(addTip(s,custom).tips[0].allocations,addTip(s,d).tips[0].allocations);
 assert.equal(isEqualSplit(custom.shares),true);
 const edited={...custom,shares:editShare(custom.shares,0,70)};
 edited.shares=editShare(edited.shares,1,10);
 assert.deepEqual(edited.shares,[70,10,20]);
 assert.deepEqual(editShare(edited.shares,0,70.5),edited.shares);
 assert.equal(Object.values(addTip(s,edited).tips[0].allocations).reduce((a,b)=>a+b,0),17500);
 for(const count of [2,3,7])for(let i=0;i<count;i++)for(const value of [0,10,70,100]){
  const result=editShare(Array(count).fill(100/count),i,value);
  assert.equal(result[i],value);assert.equal(result.reduce((a,b)=>a+b,0),100);
  assert.ok(result.every(x=>Number.isInteger(x)&&x>=0));
 }

});
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
  assert.equal(d.recipient,'person-0');assert.equal(d.split,count>1);
  const tip=addTip(s,d).tips[0];assert.equal(Object.keys(tip.allocations).length,count);
  assert.equal(Object.values(tip.allocations).reduce((a,b)=>a+b,0),35000);
  assert.equal(venueRule(s).ids.length,count);
  const distributed=distributePool(s);assert.ok(distributed.tips.every(t=>Object.keys(t.allocations).length>0));
 }
});
test('reordering employees preserves custom shares by employee ID',()=>{
 const s=seed(),d={...prepareDraft(freshDraft(),s),shares:[60,30,10],splitMode:'custom'};
 s.employees.reverse();const next=prepareDraft(d,s);
 assert.deepEqual(next.recipientIds,['max','maria','alex']);assert.deepEqual(next.shares,[10,30,60]);
 assert.deepEqual(venueRule(s).shares,[10,20,70]);
});
test('paused recipients disappear and stale payments are rejected',()=>{
 const s=seed(),d=prepareDraft({...freshDraft(),amount:'100'},s);s.employees[0].active=false;
 assert.throws(()=>addTip(s,d));
 const next=prepareDraft(d,s);assert.deepEqual(next.recipientIds,['maria','max']);assert.deepEqual(next.shares,[50,50]);
 assert.equal(next.recipient,'maria');assert.equal(addTip(s,next).tips[0].allocations.alex,undefined);
});
test('an empty team can only receive an unassigned venue tip',()=>{
 const s=seed();s.employees=[];const d=prepareDraft({...freshDraft(),amount:'100'},s);
 assert.equal(d.split,false);assert.equal(d.recipient,'pool');assert.deepEqual(addTip(s,d).tips[0].allocations,{});
 assert.throws(()=>distributePool(s));
});
