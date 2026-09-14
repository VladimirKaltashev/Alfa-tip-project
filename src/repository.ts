import {KEY,seed,addTip,freshDraft,upgradeDraft,upgradeStore} from './model';
import type {Store,Draft} from './model';
export function loadStore():Store{const raw=localStorage.getItem(KEY);if(!raw){const s=seed();localStorage.setItem(KEY,JSON.stringify(s));return s}const s=JSON.parse(raw);if(s.version!==1||!Array.isArray(s.tips)||!Array.isArray(s.employees)||!s.venue||!s.profile||!s.settings)throw new Error('Не удалось прочитать сохранённые данные демо');const updated=upgradeStore(s);if(updated!==s)localStorage.setItem(KEY,JSON.stringify(updated));return updated}
export function saveStore(s:Store){localStorage.setItem(KEY,JSON.stringify(s));window.dispatchEvent(new Event('tips-update'))}
export function loadDraft():Draft {try{const d=JSON.parse(sessionStorage.getItem('tip-draft')||'null');if(d&&typeof d.amount==='string'&&Array.isArray(d.shares))return upgradeDraft(d)}catch{/* fall back to a fresh draft */}return freshDraft()}
export function saveDraft(d:Draft){sessionStorage.setItem('tip-draft',JSON.stringify(d))}
// Replace this adapter with your acquiring API. Only a confirmed server payment
// should create a Tip in production; the demo uses no bank SDK or real payment data.
export async function confirmPayment(d:Draft){await new Promise(r=>setTimeout(r,650));const s=addTip(loadStore(),d);saveStore(s);return s.tips.find(t=>t.id===d.id)!}
