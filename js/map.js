// Leaflet map: a home marker per source, plus a pulse wherever a data event happens.
const VIEWS = {
  dk: { center: [56.1, 10.6], zoom: 7 },
  nordic: { center: [58.5, 16], zoom: 5 },
  world: { center: [30, 10], zoom: 2 },
};

export class SoundMap {
  constructor(el, sources, { onSelect }) {
    this.map = L.map(el, { zoomControl: true, worldCopyJump: true, preferCanvas: true });
    this.view('dk');
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 18,
    }).addTo(this.map);
    this.renderer = L.canvas({ padding: 0.3 });
    this.homes = {};
    this.pulses = [];
    for (const src of sources) {
      const m = L.circleMarker(src.home, {
        radius: 7, color: src.color, weight: 2, fillColor: src.color, fillOpacity: 0.15,
        dashArray: src.geo === 'virtual' ? '3 3' : null, renderer: this.renderer,
      })
        .bindTooltip(src.name + (src.geo === 'virtual' ? ' (not a place — parked at sea)' : ''))
        .on('click', () => onSelect(src.id))
        .addTo(this.map);
      this.homes[src.id] = m;
    }
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  view(name) {
    const v = VIEWS[name];
    this.map.setView(v.center, v.zoom);
  }

  setEnabled(id, enabled) {
    this.homes[id]?.setStyle({ fillOpacity: enabled ? 0.55 : 0.1, opacity: enabled ? 1 : 0.35 });
  }

  pulse(src, ev, notes) {
    const pos = ev.lat != null ? [ev.lat, ev.lon] : src.home;
    const played = notes.length > 0;
    const vel = played ? notes[0].velocity / 127 : 0.25;
    const c = L.circleMarker(pos, {
      radius: 3 + vel * 12, color: src.color, weight: played ? 2 : 1, fillColor: src.color,
      fillOpacity: played ? 0.6 : 0.15, opacity: played ? 0.9 : 0.4, renderer: this.renderer, interactive: false,
    }).addTo(this.map);
    const delay = played ? notes[0].delayMs : 0;
    this.pulses.push({ c, born: performance.now() + delay, life: played ? 1600 + notes[0].duration * 500 : 900, r: 3 + vel * 12, played });
    if (this.pulses.length > 400) this.pulses.shift().c.remove();
  }

  animate() {
    const now = performance.now();
    this.pulses = this.pulses.filter((p) => {
      const age = (now - p.born) / p.life;
      if (age >= 1) {
        p.c.remove();
        return false;
      }
      if (age > 0) {
        p.c.setRadius(p.r * (1 + age * (p.played ? 2 : 0.5)));
        p.c.setStyle({ opacity: (1 - age) * (p.played ? 0.9 : 0.4), fillOpacity: (1 - age) * (p.played ? 0.5 : 0.12) });
      }
      return true;
    });
    requestAnimationFrame(this.animate);
  }
}
