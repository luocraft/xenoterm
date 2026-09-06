/**
 * Windows timer resolution helper.
 * Calls timeBeginPeriod(1) / timeEndPeriod(1) to boost system timer resolution.
 */
import koffi from 'koffi';

let winmm: koffi.IKoffiLib | null = null;
let fnTimeBeginPeriod: ((p: number) => number) | null = null;
let fnTimeEndPeriod: ((p: number) => number) | null = null;
let periodRefCount = 0;

export function beginHighRes(): void {
  if (periodRefCount === 0) {
    try {
      if (!winmm) {
        winmm = koffi.load('winmm.dll');
        fnTimeBeginPeriod = winmm.func('uint32 __stdcall timeBeginPeriod(uint32)') as any;
        fnTimeEndPeriod = winmm.func('uint32 __stdcall timeEndPeriod(uint32)') as any;
      }
      const ret = fnTimeBeginPeriod!(1);
      console.log(`[HiResTimer] timeBeginPeriod(1) returned ${ret}`);
    } catch (e) {
      console.error('[HiResTimer] timeBeginPeriod failed:', e);
    }
  }
  periodRefCount++;
}

export function endHighRes(): void {
  periodRefCount--;
  if (periodRefCount <= 0) {
    periodRefCount = 0;
    try { fnTimeEndPeriod?.(1); } catch { /* ignore */ }
  }
}
