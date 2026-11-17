/*!
 * HotelCare booking engine loader.
 *
 * Paste on the hotel website where the booking engine should appear:
 *
 *   <div data-hotelcare-booking="ENGINE_ID" data-lang="en"></div>
 *   <script async src="https://my.hotelcare.app/booking-engine/loader.js"></script>
 *
 * The engine runs in an iframe served by HotelCare, so the website's styles
 * and scripts cannot break it and no guest data passes through the website.
 * The iframe grows with its content. Dates and campaign parameters on the
 * website URL (check_in, check_out, adults, children, rooms, utm_*, gclid…)
 * are passed through, so ads and the website's own search box can deep-link.
 *
 * When a booking is completed the loader:
 *   - pushes a GA4-style "purchase" event to window.dataLayer (Google Tag
 *     Manager / Google Ads conversion), and
 *   - dispatches a "hotelcare:booking" DOM event on window with
 *     { reference, value, currency, nights, rooms } in event.detail.
 */
(function () {
  'use strict';
  if (window.__hotelcareBookingLoader) { window.__hotelcareBookingLoader.scan(); return; }

  var script = document.currentScript;
  var ORIGIN = 'https://my.hotelcare.app';
  try { if (script && script.src) ORIGIN = new URL(script.src).origin; } catch (e) { /* keep default */ }

  var PASS_THROUGH = ['check_in', 'check_out', 'adults', 'children', 'rooms', 'lang', 'utm_source', 'utm_medium',
    'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'preview'];
  var frames = {};
  var counter = 0;

  function mount(el) {
    if (!el || el.getAttribute('data-hotelcare-mounted')) return;
    var id = (el.getAttribute('data-hotelcare-booking') || '').toLowerCase();
    if (!/^[a-z0-9]{6,32}$/.test(id)) { console.warn('HotelCare booking engine: missing or invalid engine id'); return; }
    el.setAttribute('data-hotelcare-mounted', '1');

    var frameId = 'hcbe-' + (++counter) + '-' + Math.random().toString(36).slice(2, 8);
    var params = new URLSearchParams();
    params.set('embed', '1');
    params.set('frame', frameId);
    var lang = el.getAttribute('data-lang');
    if (lang) params.set('lang', lang);
    var pageParams = new URLSearchParams(window.location.search);
    PASS_THROUGH.forEach(function (key) {
      var value = pageParams.get(key);
      if (value && !(key === 'lang' && lang)) params.set(key, value.slice(0, 200));
    });
    params.set('ref_url', window.location.href.split('#')[0].slice(0, 200));

    var iframe = document.createElement('iframe');
    iframe.src = ORIGIN + '/book/' + id + '?' + params.toString();
    iframe.name = frameId;
    iframe.title = el.getAttribute('data-title') || 'Book your stay';
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('allow', 'clipboard-write');
    iframe.style.cssText = 'display:block;width:100%;min-height:640px;border:0;background:transparent;color-scheme:light;';
    el.innerHTML = '';
    el.appendChild(iframe);
    frames[frameId] = iframe;
  }

  function scan() {
    var nodes = document.querySelectorAll('[data-hotelcare-booking]');
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== ORIGIN) return;
    var data = event.data || {};
    if (data.source !== 'hotelcare-booking') return;
    var iframe = frames[data.frame];
    if (!iframe) return;
    if (data.type === 'height' && typeof data.height === 'number') {
      iframe.style.height = Math.max(400, Math.min(20000, Math.ceil(data.height))) + 'px';
    } else if (data.type === 'scroll-top') {
      var top = iframe.getBoundingClientRect().top + (window.pageYOffset || document.documentElement.scrollTop) - 80;
      if (iframe.getBoundingClientRect().top < 0 || iframe.getBoundingClientRect().top > window.innerHeight * 0.6) {
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      }
    } else if (data.type === 'booking-complete') {
      var detail = { reference: data.reference, value: data.value, currency: data.currency, nights: data.nights, rooms: data.rooms };
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ ecommerce: null });
      window.dataLayer.push({
        event: 'purchase',
        hotelcare_booking: true,
        ecommerce: {
          transaction_id: data.reference,
          value: Number(data.value) || 0,
          currency: data.currency,
          items: [{ item_id: 'room-night', item_name: 'Hotel stay', quantity: Number(data.nights) || 1 }]
        }
      });
      try { window.dispatchEvent(new CustomEvent('hotelcare:booking', { detail: detail })); } catch (e) { /* old browsers */ }
    }
  });

  window.__hotelcareBookingLoader = { scan: scan };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
  else scan();
})();
