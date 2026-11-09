/**
 * Stockage compact (tableaux typés, en colonnes) des horaires retenus : quelques octets par passage,
 * pour tenir les millions de lignes de stop_times d'un gros réseau sans objets JavaScript par ligne.
 */

function grow<T extends Int32Array | Int16Array | Uint8Array>(a: T, size: number): T {
  const Ctor = a.constructor as new (n: number) => T;
  const b = new Ctor(size);
  b.set(a);
  return b;
}

export class StopTimeStore {
  length = 0;
  trip: Int32Array;
  stop: Int32Array;
  seq: Int32Array;
  arr: Int16Array;
  dep: Int16Array;
  /** bit 0 : pas de montée (pickup_type 1) ; bit 1 : pas de descente (drop_off_type 1). */
  flags: Uint8Array;

  constructor(capacity = 1 << 16) {
    this.trip = new Int32Array(capacity);
    this.stop = new Int32Array(capacity);
    this.seq = new Int32Array(capacity);
    this.arr = new Int16Array(capacity);
    this.dep = new Int16Array(capacity);
    this.flags = new Uint8Array(capacity);
  }

  push(trip: number, stop: number, seq: number, arr: number, dep: number, flags: number): void {
    if (this.length === this.trip.length) {
      const size = Math.ceil(this.trip.length * 1.5) + 1024;
      this.trip = grow(this.trip, size);
      this.stop = grow(this.stop, size);
      this.seq = grow(this.seq, size);
      this.arr = grow(this.arr, size);
      this.dep = grow(this.dep, size);
      this.flags = grow(this.flags, size);
    }
    const i = this.length++;
    this.trip[i] = trip;
    this.stop[i] = stop;
    this.seq[i] = seq;
    this.arr[i] = arr;
    this.dep[i] = dep;
    this.flags[i] = flags;
  }

  /**
   * Trie par (voyage, stop_sequence) et renvoie le début de chaque voyage : les passages du voyage t occupent
   * [start[t], start[t + 1]). Tri par comptage sur le voyage (linéaire), puis tri du rare voyage désordonné.
   */
  sortByTrip(nTrips: number): Int32Array {
    const n = this.length;
    const start = new Int32Array(nTrips + 1);
    for (let i = 0; i < n; i++) start[this.trip[i] + 1]++;
    for (let t = 0; t < nTrips; t++) start[t + 1] += start[t];
    const pos = start.slice(0, nTrips);
    const order = new Int32Array(n);
    for (let i = 0; i < n; i++) order[pos[this.trip[i]]++] = i;
    for (let t = 0; t < nTrips; t++) {
      const a = start[t];
      const b = start[t + 1];
      let sorted = true;
      for (let i = a + 1; i < b; i++) {
        if (this.seq[order[i]] < this.seq[order[i - 1]]) {
          sorted = false;
          break;
        }
      }
      if (!sorted) {
        const part = Array.from(order.subarray(a, b)).sort((x, y) => this.seq[x] - this.seq[y] || x - y);
        order.set(part, a);
      }
    }
    const permute = <T extends Int32Array | Int16Array | Uint8Array>(src: T): T => {
      const Ctor = src.constructor as new (n: number) => T;
      const dst = new Ctor(n);
      for (let i = 0; i < n; i++) dst[i] = src[order[i]];
      return dst;
    };
    this.trip = permute(this.trip);
    this.stop = permute(this.stop);
    this.seq = permute(this.seq);
    this.arr = permute(this.arr);
    this.dep = permute(this.dep);
    this.flags = permute(this.flags);
    return start;
  }

  /** Octets occupés (mémoire allouée). */
  bytes(): number {
    return this.trip.byteLength + this.stop.byteLength + this.seq.byteLength + this.arr.byteLength + this.dep.byteLength + this.flags.byteLength;
  }
}
