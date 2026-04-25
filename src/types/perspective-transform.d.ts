declare module 'perspective-transform' {
  interface PerspTInstance {
    transform(x: number, y: number): [number, number];
    transformInverse(x: number, y: number): [number, number];
    coeffs: number[];
    coeffsInv: number[];
    srcPts: number[];
    dstPts: number[];
  }
  function PerspT(srcPts: number[], dstPts: number[]): PerspTInstance;
  export default PerspT;
}
