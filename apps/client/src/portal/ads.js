// Minimal portal ads adapter.
//
// Portals can inject an implementation at runtime:
//   window.__BT_ADS__ = {
//     showInterstitial: async (ctx) => { ... },
//     showRewarded: async (ctx) => ({ ok: true }),
//   }
//
// This module is intentionally defensive:
// - No hard dependency on any portal SDK.
// - Never throws (errors are swallowed).
// - Never blocks sim/inputs.

function getAds() {
  const w = (typeof window !== 'undefined') ? window : null;
  const ads = w && w.__BT_ADS__;
  if (!ads || typeof ads !== 'object') return null;
  return ads;
}

export function isAdsAvailable() {
  const ads = getAds();
  return !!(ads && (typeof ads.showInterstitial === 'function' || typeof ads.showRewarded === 'function'));
}

export function maybeShowInterstitial(ctx = {}) {
  try {
    const ads = getAds();
    if (!ads || typeof ads.showInterstitial !== 'function') return;
    // Fire-and-forget on purpose.
    Promise.resolve(ads.showInterstitial({ game: 'Be_Try_Arena_BR', ...ctx })).catch(() => {});
  } catch (_) {
    // swallow
  }
}

export async function maybeShowRewarded(ctx = {}) {
  try {
    const ads = getAds();
    if (!ads || typeof ads.showRewarded !== 'function') return { ok: false, reason: 'unavailable' };
    const res = await Promise.resolve(ads.showRewarded({ game: 'Be_Try_Arena_BR', ...ctx }));
    if (res && typeof res === 'object') return res;
    return { ok: true };
  } catch (_) {
    return { ok: false, reason: 'error' };
  }
}
