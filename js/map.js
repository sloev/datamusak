// OpenStreetMap, put through the datamusak blender: grayscale tiles under a drifting rainbow
// (multiply blend), black-outlined source homes, and a pulse wherever a data event happens.
const VIEWS = {
  dk: { center: [56.1, 10.6], zoom: 7 },
  nordic: { center: [58.5, 16], zoom: 5 },
  world: { center: [30, 10], zoom: 2 },
};

export class SoundMap {
  constructor(el, sources, { onSelect }) {
    this.map = L.map(el, { zoomControl: true, worldCopyJump: true, preferCanvas: true });
    this.view('dk');
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(this.map);
    this.addRainbow();
    this.renderer = L.canvas({ padding: 0.3 });
    this.homes = {};
    this.pulses = [];
    for (const src of sources) {
      const m = L.circleMarker(src.home, {
        radius: 8, color: '#000', weight: 3, fillColor: src.color, fillOpacity: 1,
        dashArray: src.geo === 'virtual' ? '4 3' : null, renderer: this.renderer,
      })
        .bindTooltip(src.name + (src.geo === 'virtual' ? ' (no real place — parked at sea)' : ''))
        .on('click', () => onSelect(src.id))
        .addTo(this.map);
      this.homes[src.id] = m;
    }
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  // A viewport-sized layer between tiles and markers, kept still while the map pans.
  addRainbow() {
    const pane = this.map.createPane('rainbow');
    pane.style.zIndex = 250;
    pane.style.pointerEvents = 'none';
    const div = L.DomUtil.create('div', 'rainbow-wash', pane);
    const place = () => {
      const size = this.map.getSize();
      div.style.width = size.x + 'px';
      div.style.height = size.y + 'px';
      L.DomUtil.setPosition(div, this.map.containerPointToLayerPoint([0, 0]));
    };
    this.map.on('move zoom viewreset resize zoomend moveend', place);
    place();
  }

  view(name) {
    const v = VIEWS[name];
    this.map.setView(v.center, v.zoom);
  }

  setEnabled(id, enabled) {
    this.homes[id]?.setStyle({ fillOpacity: enabled ? 1 : 0.25, opacity: enabled ? 1 : 0.4, radius: enabled ? 9 : 6 });
  }

  pulse(src, ev, notes) {
    const pos = ev.lat != null ? [ev.lat, ev.lon] : src.home;
    const played = notes.length > 0;
    const vel = played ? notes[0].velocity / 127 : 0.2;
    const r = 3 + vel * 13;
    const c = L.circleMarker(pos, {
      radius: r, color: '#000', weight: played ? 2.5 : 1, fillColor: src.color,
      fillOpacity: played ? 0.95 : 0.35, opacity: played ? 1 : 0.35, renderer: this.renderer, interactive: false,
    }).addTo(this.map);
    const delay = played ? notes[0].delayMs : 0;
    this.pulses.push({ c, born: performance.now() + delay, life: played ? 1400 + notes[0].duration * 500 : 800, r, played });
    if (this.pulses.length > 350) this.pulses.shift().c.remove();
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
        // pop in fast, then sag out
        const grow = p.played ? 1 + Math.sin(Math.min(1, age * 4) * Math.PI * 0.5) * 0.8 + age : 1 + age * 0.4;
        p.c.setRadius(p.r * grow);
        p.c.setStyle({ opacity: (1 - age) * (p.played ? 1 : 0.35), fillOpacity: (1 - age) * (p.played ? 0.95 : 0.3) });
      }
      return true;
    });
    requestAnimationFrame(this.animate);
  }
}
