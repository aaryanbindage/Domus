import { api } from './api.js';

export const state = { me: null, listeners: new Set() };

export async function refreshMe() {
  state.me = await api.get('/api/account/me');
  for (const fn of state.listeners) fn(state.me);
  return state.me;
}
export const onMe = (fn) => state.listeners.add(fn);
export const user = () => state.me?.user || null;
export const nation = () => state.me?.nation || { name: 'Republic of Veridia', short: 'Veridia', currency: { symbol: 'SGL', name: 'Sigil', plural: 'Sigils' } };
export const isCitizen = () => user()?.status === 'citizen';
export const isOfficial = () => ['official', 'admin'].includes(user()?.role);
export const isAdmin = () => user()?.role === 'admin';
export const elevated = () => (state.me?.elevation?.passportUntil || 0) > Date.now();
