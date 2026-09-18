import {KEY,seed,addTip,freshDraft,upgradeDraft,upgradeStore} from './model';
import type {Store,Draft} from './model';
export function loadStore():Store{const raw=localStorage.getItem(KEY);if(!raw){const s=seed();localStorage.setItem(KEY,JSON.stringify(s));return s}const s=JSON.parse(raw);if(s.version!==1||!Array.isArray(s.tips)||!Array.isArray(s.employees)||!s.venue||!s.profile||!s.settings)throw new Error('Не удалось прочитать сохранённые данные демо');const updated=upgradeStore(s);if(updated!==s)localStorage.setItem(KEY,JSON.stringify(updated));return updated}
export function saveStore(s:Store){localStorage.setItem(KEY,JSON.stringify(s));window.dispatchEvent(new Event('tips-update'))}
export const DRAFT_KEY='alfa-tips-draft-v3';
export function loadDraft():Draft {try{const raw=localStorage.getItem(DRAFT_KEY)||sessionStorage.getItem('tip-draft');const d=JSON.parse(raw||'null');if(d&&typeof d.amount==='string'&&Array.isArray(d.shares)){const updated=upgradeDraft(d);localStorage.setItem(DRAFT_KEY,JSON.stringify(updated));sessionStorage.removeItem('tip-draft');return updated}}catch{/* fall back to a fresh draft */}return freshDraft()}
export function saveDraft(d:Draft){localStorage.setItem(DRAFT_KEY,JSON.stringify(d))}
export function clearDraft(){localStorage.removeItem(DRAFT_KEY);sessionStorage.removeItem('tip-draft')}
// Replace this adapter with your acquiring API. Only a confirmed server payment
// should create a Tip in production; the demo uses no bank SDK or real payment data.
export async function confirmPayment(d:Draft){await new Promise(r=>setTimeout(r,650));const s=addTip(loadStore(),d);saveStore(s);return s.tips.find(t=>t.id===d.id)!}
