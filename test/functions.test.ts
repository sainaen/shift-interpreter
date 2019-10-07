import { assertResult, compare } from "./util";

describe("Functions", () => {
  it("should declare functions", () => {
    assertResult(compare("function a(){return 2}; a();"));
  });
  it("should assign arrow expressions", () => {
    assertResult(compare("let a = (a) => {return a}; a(4)"));
  });
  it("arrow expressions should retain `this` binding", () => {
    assertResult(compare("let a = { a: () => {return this.b}, b: 44 }; const b = a.a; a.a() + b();"));
  });
  it("should evaluate shorthand arrow expressions", () => {
    assertResult(compare("let a = _ => _ + 10; a(2);"));
  });
  it("should call functions with arguments that have defaults", () => {
    assertResult(compare("function a(a = 22){return a + 10}; a() + a(33);"));
  });
  it("should call functions with arguments", () => {
    assertResult(compare("function a(a,b){return a+b}; a(2,5) === 7;"));
  });
  it("should access appropriate context", () => {
    assertResult(
      compare(`
    var c = {
      expected: "hello",
      test: function(actual) {
        return actual === c.expected;
      }
    };
    c.test("hello") === true;
    `)
    );
    assertResult(
      compare(`
    var c = {
      expected: "hello",
      test: function(actual) {
        return actual === c.expected;
      }
    };
    var b = {
      expected: "on b"
    };
    b.test = c.test;
    b.test('on b') === true;
    `)
    );
  });
  it("should store and execute function expressions", () => {
    assertResult(compare("let a = function(){return 2}; a();"));
  });
  it.only("should return from sub statements", () => {
    assertResult(compare("function a() { if (true) return 'in branch'; return 'should not get here'}; a();"));
  });
});

describe("Getters/Setters", () => {
  it("should define getters", () => {
    assertResult(compare("let a = { get b() {return 2} }; a.b;"));
  });
  it("should define setters", () => {
    assertResult(compare("let a = { set b(c) {this._b = c} }; a.b = 22; a._b"));
  });
  it("should define both", () => {
    assertResult(compare("let a = { set b(c) {this._b = c + 10}, get b(){return this._b} }; a.b = 22; a.b"));
  });
});
