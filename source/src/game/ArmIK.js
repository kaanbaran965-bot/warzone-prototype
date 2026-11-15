import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3();
const _ab = new THREE.Vector3(), _ac = new THREE.Vector3(), _at = new THREE.Vector3(), _ba = new THREE.Vector3(), _bc = new THREE.Vector3();
const _ax0 = new THREE.Vector3(), _ax1 = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qp = new THREE.Quaternion();
const _r0 = new THREE.Quaternion(), _r1 = new THREE.Quaternion(), _r2 = new THREE.Quaternion();
const acosC = (x) => Math.acos(Math.min(1, Math.max(-1, x)));

// Analytic two-bone IK (upper arm -> forearm -> wrist), keeping the authored elbow plane.
// Shoulders stay put while the gun and hands move, so forearms bend naturally instead of
// the whole arm being glued to the weapon.
export class ArmIK {
  constructor(upper, fore, end, hand, twists = []) {
    this.upper = upper; this.fore = fore; this.end = end; this.hand = hand; this.twists = twists;
    this.restUpper = upper.quaternion.clone();
    this.restFore = fore.quaternion.clone();
    this.restTwist = twists.map((b) => b.quaternion.clone());
    this.offset = new THREE.Vector3();   // wrist end relative to hand, in hand space
    this.restHandQ = new THREE.Quaternion();
  }
  // call once with everything at rest pose and world matrices up to date
  captureRest() {
    this.end.getWorldPosition(_c);
    this.hand.updateWorldMatrix(true, false);
    const inv = this.hand.matrixWorld.clone().invert();
    this.offset.copy(_c).applyMatrix4(inv);
    this.hand.getWorldQuaternion(this.restHandQ);
    this.fore.getWorldPosition(_b); this.upper.getWorldPosition(_a);
    this.lenA = _a.distanceTo(_b); this.lenB = _b.distanceTo(_c);
  }
  solve() {
    this.upper.quaternion.copy(this.restUpper);
    this.fore.quaternion.copy(this.restFore);
    this.upper.updateWorldMatrix(true, true);
    this.hand.updateWorldMatrix(true, false);
    _t.copy(this.offset).applyMatrix4(this.hand.matrixWorld);
    this.upper.getWorldPosition(_a); this.fore.getWorldPosition(_b); this.end.getWorldPosition(_c);
    const lab = this.lenA, lcb = this.lenB, eps = 1e-4;
    const lat = Math.min(Math.max(_at.subVectors(_t, _a).length(), eps), lab + lcb - eps);
    _ab.subVectors(_b, _a).normalize(); _ac.subVectors(_c, _a).normalize(); _at.normalize();
    _ba.subVectors(_a, _b).normalize(); _bc.subVectors(_c, _b).normalize();
    const ac_ab_0 = acosC(_ac.dot(_ab));
    const ba_bc_0 = acosC(_ba.dot(_bc));
    const ac_at_0 = acosC(_ac.dot(_at));
    const ac_ab_1 = acosC((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat));
    const ba_bc_1 = acosC((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb));
    _ax0.crossVectors(_ac, _ab); if (_ax0.lengthSq() < 1e-10) _ax0.set(1, 0, 0); _ax0.normalize();
    _ax1.crossVectors(_ac, _at); if (_ax1.lengthSq() < 1e-10) _ax1.set(1, 0, 0); _ax1.normalize();
    _r0.setFromAxisAngle(_ax0, ac_ab_1 - ac_ab_0);
    _r1.setFromAxisAngle(_ax0, ba_bc_1 - ba_bc_0);
    _r2.setFromAxisAngle(_ax1, ac_at_0);
    this.upper.getWorldQuaternion(_qa); this.fore.getWorldQuaternion(_qb);
    const rot = _r2.clone().multiply(_r0);
    const qaNew = rot.clone().multiply(_qa);
    const qbNew = rot.multiply(_r1).multiply(_qb);
    this.upper.parent.getWorldQuaternion(_qp);
    this.upper.quaternion.copy(_qp.invert().multiply(qaNew));
    this.fore.quaternion.copy(qaNew.invert().multiply(qbNew));
    this.upper.updateWorldMatrix(false, true);
  }
}
