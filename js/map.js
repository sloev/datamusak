// A vector map with no tile server and no key: Natural Earth coastlines (Denmark at 1:10m) drawn
// as neon lines on pure black, plus outlined source homes and a pulse wherever data happens.
const VIEWS = {
  dk: { center: [56.1, 10.6], zoom: 7 },
  nordic: { center: [58.5, 16], zoom: 5 },
  world: { center: [30, 10], zoom: 2 },
};

const RECENT_MS = 90000;

export class SoundMap {
  constructor(el, sources, { onSelect, onViewChange = () => {} }) {
    this.map = L.map(el, { zoomControl: false, worldCopyJump: true, preferCanvas: true });
    L.control.zoom({ position: 'bottomleft' }).addTo(this.map);
    this.sources = sources;
    this.enabled = new Set();
    this.recent = []; // [lat, lon, sourceId, time] of recent events
    this.onViewChange = onViewChange;
    this.current = 'auto';
    this.map.setView(VIEWS.dk.center, VIEWS.dk.zoom);
    // AUTO: keep every recent event of the sources that are on in view; any manual pan/zoom ends it
    this.map.on('dragstart', () => this.view('manual'));
    el.addEventListener('wheel', () => this.view('manual'), { passive: true });
    el.addEventListener('dblclick', () => this.view('manual'));
    el.addEventListener('touchstart', (e) => e.touches.length > 1 && this.view('manual'), { passive: true });
    el.querySelector('.leaflet-control-zoom')?.addEventListener('click', () => this.view('manual'));
    setInterval(() => this.fit(), 4000);
    this.map.attributionControl.addAttribution('Coastlines: <a href="https://www.naturalearthdata.com/">Natural Earth</a>');
    // coastlines get their own canvas, so the animated pulses never force them to redraw
    const coastPane = this.map.createPane('coast');
    coastPane.style.zIndex = 350;
    coastPane.style.pointerEvents = 'none';
    this.coastRenderer = L.canvas({ padding: 0.5, pane: 'coast' });
    this.renderer = L.canvas({ padding: 0.3 });
    this.drawCoast();
    this.homes = {};
    this.pulses = [];
    for (const src of sources) {
      const m = L.circleMarker(src.home, {
        radius: 8, color: '#050505', weight: 3, fillColor: src.color, fillOpacity: 1,
        dashArray: src.geo === 'virtual' ? '4 3' : null, renderer: this.renderer,
      })
        .bindTooltip(src.name + (src.geo === 'virtual' ? ' (no real place — parked at sea)' : ''))
        .on('click', () => onSelect(src.id))
        .addTo(this.map);
      this.homes[src.id] = m;
    }
    // Fingers are bigger than 8 px pins: a tap selects the nearest home within 22 px. (It also
    // doesn't depend on the browser turning touches into clicks on the map's canvas.)
    let touch = null;
    el.addEventListener('touchstart', (e) => {
      touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() } : null;
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      const end = e.changedTouches[0];
      if (e.target.closest?.('.leaflet-control')) return; // zoom buttons stay buttons
      if (!touch || !end || Math.hypot(end.clientX - touch.x, end.clientY - touch.y) > 10 || performance.now() - touch.t > 600) return;
      const r = el.getBoundingClientRect();
      const pt = L.point(end.clientX - r.left, end.clientY - r.top);
      let best = null;
      for (const src of sources) {
        const d = this.map.latLngToContainerPoint(src.home).distanceTo(pt);
        if (d < 22 && (!best || d < best.d)) best = { id: src.id, d };
      }
      if (best) {
        e.preventDefault(); // no second, synthesized click
        onSelect(best.id);
      }
    });
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  async drawCoast() {
    try {
      const { lines, borders } = await (await fetch(new URL('../assets/map/coast.json', import.meta.url))).json();
      const toLatLngs = (flat) => {
        const out = [];
        for (let i = 0; i < flat.length; i += 2) out.push([flat[i + 1], flat[i]]);
        return out;
      };
      const coast = L.layerGroup().addTo(this.map);
      for (const l of borders) L.polyline(toLatLngs(l), { color: '#ffe61a', weight: 1, dashArray: '2 5', interactive: false, renderer: this.coastRenderer }).addTo(coast);
      for (const l of lines) L.polyline(toLatLngs(l), { color: '#1af2ff', weight: 1.6, interactive: false, renderer: this.coastRenderer }).addTo(coast);
    } catch {}
  }

  // 'auto' | 'dk' | 'nordic' | 'world' | 'manual'
  view(name) {
    if (this.current === name && name !== 'auto') return;
    this.current = name;
    if (VIEWS[name]) this.map.setView(VIEWS[name].center, VIEWS[name].zoom);
    if (name === 'auto') this.fit(true);
    this.onViewChange(name);
  }

  // The bounding box of what the enabled sources have been doing lately (or their home pins).
  autoBounds(now = performance.now()) {
    this.recent = this.recent.filter((r) => now - r[3] < RECENT_MS);
    const pts = this.recent.filter((r) => this.enabled.has(r[2])).map((r) => [r[0], r[1]]);
    for (const src of this.sources) if (this.enabled.has(src.id)) pts.push(src.home);
    return pts.length ? L.latLngBounds(pts) : L.latLngBounds([[54.5, 8], [57.8, 15.2]]);
  }

  fit(force = false) {
    if (this.current !== 'auto') return;
    const b = this.autoBounds();
    const view = this.map.getBounds();
    // leave the view alone if it already shows everything and isn't much too big
    if (!force && view.contains(b) && this.map.getBoundsZoom(b.pad(0.15)) - this.map.getZoom() < 1.5) return;
    this.fitting = true;
    this.map.fitBounds(b.pad(0.15), { maxZoom: 9, animate: true, duration: 0.6 });
    this.map.once('moveend', () => (this.fitting = false));
  }

  setEnabled(id, enabled) {
    enabled ? this.enabled.add(id) : this.enabled.delete(id);
    this.homes[id]?.setStyle({ fillOpacity: enabled ? 1 : 0.25, opacity: enabled ? 1 : 0.4, radius: enabled ? 9 : 6 });
  }

  // Played notes: a full-saturation ring that pops out in a few hard steps, then vanishes.
  // Events that didn't play: a small dot that blinks once. No fades — no muddy midtones.
  pulse(src, ev, notes) {
    const pos = ev.lat != null ? [ev.lat, ev.lon] : src.home;
    if (ev.lat != null) this.recent.push([ev.lat, ev.lon, src.id, performance.now()]);
    if (this.recent.length > 2000) this.recent.splice(0, 500);
    const played = notes.length > 0;
    const vel = played ? notes[0].velocity / 127 : 0;
    const r = played ? 5 + vel * 12 : 2.5;
    const c = L.circleMarker(pos, {
      radius: r, color: played ? src.color : '#050505', weight: played ? 3 : 1, fill: !played || vel > 0.8,
      fillColor: src.color, fillOpacity: 1, opacity: 1, renderer: this.renderer, interactive: false,
    });
    const delay = played ? notes[0].delayMs : 0;
    this.pulses.push({ c, born: performance.now() + delay, life: played ? 600 : 300, r, played, shown: false });
    if (this.pulses.length > 300) this.pulses.shift().c.remove();
  }

  animate() {
    const now = performance.now();
    this.pulses = this.pulses.filter((p) => {
      const age = (now - p.born) / p.life;
      if (age >= 1) {
        p.c.remove();
        return false;
      }
      if (age >= 0) {
        if (!p.shown) {
          p.c.addTo(this.map);
          p.shown = true;
        }
        // 4 hard steps (≈ demo cadence) instead of a smooth ease
        const step = Math.floor(age * 4) / 4;
        if (p.played && step !== p.step) {
          p.step = step;
          p.c.setRadius(p.r * (1 + step * 1.6));
        }
      }
      return true;
    });
    requestAnimationFrame(this.animate);
  }
}
