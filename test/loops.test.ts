import { assertResult, compare } from "./util";

describe("Loops", () => {
  it("should evaluate basic for loops", () => {
    assertResult(compare('let b = 0; for (let a = 1; a <= 2; a++) {b = b + a} b;'))
  });
  it("should support break statements", () => {
    assertResult(compare('let b = 0; for (let a = 1; a <= 2; a++) {b = b + a; break} b;'))
  });
  it("should support nested break statements", () => {
    assertResult(compare('let b = 0; for (let a = 1; a <= 2; a++) {for (let i = 1; i < 10; i++) {break; b++;}; b = b + a;} b;'))
  });
  it("should support continue statements", () => {
    assertResult(compare('let b = 0; for (let a = 1; a <= 2; a++) {b = b + a; continue; b += 2} b;'))
  });
  it("should support nested continue statements", () => {
    assertResult(compare('let b = 0; for (let a = 1; a <= 2; a++) {for (let i = 1; i < 10; i++) {b++; continue; b++;}; b = b + a;} b;'))
  });
  it("should support while statements", () => {
    assertResult(compare('let a = 0; while(a < 10) {a++} a;'))
  });
  it("should support do-while statements", () => {
    assertResult(compare('let a = 0; do{a++}while(a < 10) a;'))
  });
});
