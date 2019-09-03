import {
  AssignmentTargetIdentifier,
  BindingIdentifier,
  Block,
  Expression,
  FunctionBody,
  FunctionDeclaration,
  IdentifierExpression,
  Script,
  Statement,
  VariableDeclaration,
  Super,
  ForStatement,
  WhileStatement,
  ForOfStatement,
  ForInStatement,
  DoWhileStatement
} from "shift-ast";
import shiftScope, { ScopeLookup } from "shift-scope";
import { InterpreterContext } from "./context";
import { InterpreterFunction } from "./intermediate-types";

export class InterpreterRuntimeError extends Error {}

const binaryOperatorMap = new Map<string, any>([
  ["+", (l: any, r: any) => l + r],
  ["-", (l: any, r: any) => l - r],
  ["/", (l: any, r: any) => l / r],
  ["*", (l: any, r: any) => l * r],
  ["**", (l: any, r: any) => l ** r],
  ["==", (l: any, r: any) => l == r],
  ["!=", (l: any, r: any) => l != r],
  ["===", (l: any, r: any) => l === r],
  ["!==", (l: any, r: any) => l !== r],
  ["<", (l: any, r: any) => l < r],
  ["<=", (l: any, r: any) => l <= r],
  [">", (l: any, r: any) => l > r],
  [">=", (l: any, r: any) => l >= r],
  ["in", (l: any, r: any) => l in r],
  ["instanceof", (l: any, r: any) => l instanceof r],
  ["<<", (l: any, r: any) => l << r],
  [">>", (l: any, r: any) => l >> r],
  [">>>", (l: any, r: any) => l >>> r],
  ["%", (l: any, r: any) => l % r],
  [",", (l: any, r: any) => r],
  ["||", (l: any, r: any) => l || r],
  ["&&", (l: any, r: any) => l && r],
  ["|", (l: any, r: any) => l | r],
  ["&", (l: any, r: any) => l & r],
  ["^", (l: any, r: any) => l ^ r]
]);

const unaryOperatorMap = new Map<string, any>([
  ["+", (oper: any) => +oper],
  ["-", (oper: any) => -oper],
  ["!", (oper: any) => !oper],
  ["~", (oper: any) => ~oper],
  ["typeof", (oper: any) => typeof oper],
  ["void", (oper: any) => void oper]
  // ["delete", (l: any) => l * r],
]);

const compoundAssignmentOperatorMap = new Map<string, any>([
  ["+=", (l: any, r: any) => l + r],
  ["-=", (l: any, r: any) => l - r],
  ["/=", (l: any, r: any) => l / r],
  ["*=", (l: any, r: any) => l * r],
  ["**=", (l: any, r: any) => l ** r],
  ["<<=", (l: any, r: any) => l << r],
  [">>=", (l: any, r: any) => l >> r],
  [">>>=", (l: any, r: any) => l >>> r],
  ["%=", (l: any, r: any) => l % r],
  ["|=", (l: any, r: any) => l | r],
  ["&=", (l: any, r: any) => l & r],
  ["^=", (l: any, r: any) => l ^ r]
]);

type Identifier =
  | BindingIdentifier
  | IdentifierExpression
  | AssignmentTargetIdentifier;

type Loop =
  | ForStatement
  | WhileStatement
  | ForOfStatement
  | ForInStatement
  | DoWhileStatement;

interface Options {
  skipUnsupported?: boolean;
}

export class Interpreter {
  private contexts: InterpreterContext[];
  private globalScope: any;
  private scopeLookup: any;
  private variableMap = new Map();
  private options: Options;
  private currentScript?: Script;
  private currentLoops: Loop[] = [];

  constructor(context: InterpreterContext = {}, options: Options = {}) {
    this.contexts = [context];
    this.options = options;
  }
  skipOrThrow(type: string) {
    if (this.options.skipUnsupported) return;
    throw new InterpreterRuntimeError(`Unsupported node ${type}`);
  }
  analyze(script: Script) {
    this.globalScope = shiftScope(script);
    this.scopeLookup = new ScopeLookup(this.globalScope).variableMap;
    this.currentScript = script;
  }
  pushContext(context: InterpreterContext) {
    this.contexts.push(context);
  }
  popContext() {
    return this.contexts.pop();
  }
  evaluate(script?: Script) {
    if (script) this.analyze(script);
    let program = script || this.currentScript;
    if (!program) throw new InterpreterRuntimeError("No script to evaluate");
    return this.evaluateBlock(program).returnValue;
  }
  evaluateBlock(block: Block | Script | FunctionBody) {
    let returnValue = undefined;
    let didBreak = false;
    let didContinue = false;
    for (let i = 0; i < block.statements.length; i++) {
      if (block.statements[i].type === "BreakStatement") {
        didBreak = true;
        break;
      }
      if (block.statements[i].type === "ContinueStatement") {
        didContinue = true;
        break;
      }
      returnValue = this.evaluateStatement(block.statements[i]);
    }
    return { returnValue, didBreak, didContinue };
  }
  evaluateStatement(stmt: Statement): any {
    if (!this.contexts) return;
    switch (stmt.type) {
      case "ReturnStatement":
      case "ExpressionStatement":
        return this.evaluateExpression(stmt.expression);
      case "VariableDeclarationStatement":
        return this.declareVariables(stmt.declaration);
      case "FunctionDeclaration":
        return this.declareFunction(stmt);
      case "BlockStatement":
        return this.evaluateBlock(stmt.block).returnValue;
      case "IfStatement": {
        const test = this.evaluateExpression(stmt.test);
        if (test) return this.evaluateStatement(stmt.consequent);
        else if (stmt.alternate) return this.evaluateStatement(stmt.alternate);
        break;
      }
      case "BreakStatement":
        break;
      case "ContinueStatement":
        break;
      case "ForStatement": {
        this.currentLoops.push(stmt);
        if (stmt.init) {
          if (stmt.init.type === "VariableDeclaration")
            this.declareVariables(stmt.init);
          else this.evaluateExpression(stmt.init);
        }
        while (this.evaluateExpression(stmt.test)) {
          if (stmt.body.type === "BlockStatement") {
            const blockResult = this.evaluateBlock(stmt.body.block);
            if (blockResult.didBreak) break;
          } else {
            this.evaluateStatement(stmt.body);
          }
          if (stmt.update) this.evaluateExpression(stmt.update);
        }
        this.currentLoops.pop();
        break;
      }
      case "WhileStatement": {
        this.currentLoops.push(stmt);
        while (this.evaluateExpression(stmt.test)) {
          if (stmt.body.type === "BlockStatement") {
            const blockResult = this.evaluateBlock(stmt.body.block);
            if (blockResult.didBreak) break;
          } else {
            this.evaluateStatement(stmt.body);
          }
        }
        this.currentLoops.pop();
        break;
      }
      case "DoWhileStatement": {
        this.currentLoops.push(stmt);
        do {
          if (stmt.body.type === "BlockStatement") {
            const blockResult = this.evaluateBlock(stmt.body.block);
            if (blockResult.didBreak) break;
          } else {
            this.evaluateStatement(stmt.body);
          }
        } while (this.evaluateExpression(stmt.test))
        this.currentLoops.pop();
        break;
      }
      case "EmptyStatement":
        break;
      default:
        return this.skipOrThrow(stmt.type);
    }
  }
  declareFunction(decl: FunctionDeclaration) {
    const variables = this.scopeLookup.get(decl.name);

    if (variables.length > 1)
      throw new Error("reproduce this and handle it better");
    const variable = variables[0];

    this.variableMap.set(variable, new InterpreterFunction(decl, this));
  }
  declareVariables(decl: VariableDeclaration) {
    decl.declarators.forEach(declarator => {
      if (declarator.binding.type === "BindingIdentifier") {
        const variables = this.scopeLookup.get(declarator.binding);

        if (variables.length > 1)
          throw new Error("reproduce this and handle it better");
        const variable = variables[0];
        const init = this.evaluateExpression(declarator.init);
        this.variableMap.set(variable, init);
      } else {
        this.skipOrThrow(`VariableDeclaration ${declarator.binding.type}`);
      }
    });
  }
  updateVariableValue(node: Identifier, value: any) {
    const variables = this.scopeLookup.get(node);

    if (variables.length > 1)
      throw new Error("reproduce this and handle it better");
    const variable = variables[0];
    this.variableMap.set(variable, value);
    return value;
  }
  getVariableValue(node: Identifier): any {
    const variables = this.scopeLookup.get(node);

    if (variables.length > 1)
      throw new Error("reproduce this and handle it better");
    const variable = variables[0];
    if (this.variableMap.has(variable)) {
      return this.variableMap.get(variable);
    } else {
      for (let i = this.contexts.length - 1; i > -1; i--) {
        if (variable.name in this.contexts[i])
          return this.contexts[i][variable.name];
      }
      return undefined;
    }
  }
  getCurrentContext() {
    return this.contexts[this.contexts.length - 1];
  }
  evaluateExpression(expr: Expression | Super | null): any {
    
    // This might be incorrect behavior ¯\_(ツ)_/¯
    if (expr === null) return; 

    switch (expr.type) {
      case "ThisExpression": {
        return this.getCurrentContext();
      }
      case "ObjectExpression": {
        const entries = expr.properties.map(prop => {
          switch (prop.type) {
            case "DataProperty": {
              const name =
                prop.name.type === "StaticPropertyName"
                  ? prop.name.value
                  : this.evaluateExpression(prop.name.expression);
              return [name, this.evaluateExpression(prop.expression)];
            }
            case "Method": {
              const name =
                prop.name.type === "StaticPropertyName"
                  ? prop.name.value
                  : this.evaluateExpression(prop.name.expression);
              return [name, new InterpreterFunction(prop, this)];
            }
            default:
              this.skipOrThrow(`${expr.type}[${prop.type}]`);
              return [];
          }
        });
        return Object.fromEntries(entries);
      }
      case "StaticMemberExpression": {
        if (expr.object.type === "Super")
          return this.skipOrThrow(expr.object.type);
        const object = this.evaluateExpression(expr.object);
        const value = object[expr.property];
        // if (typeof value === "function") return value.bind(object);
        return value;
      }
      case "ComputedMemberExpression": {
        if (expr.object.type === "Super")
          return this.skipOrThrow(expr.object.type);
        const object = this.evaluateExpression(expr.object);
        const value = object[this.evaluateExpression(expr.expression)];
        // if (typeof value === "function") return value.bind(object);
        return value;
      }
      case "FunctionExpression":
        return new InterpreterFunction(expr, this);
      case "CallExpression": {
        if (expr.callee.type === "Super")
          return this.skipOrThrow(expr.callee.type);

        const args: any[] = [];
        expr.arguments.forEach(_ => {
          if (_.type === "SpreadElement") {
            const value = this.evaluateExpression(_.expression);
            args.push(...value);
          } else {
            args.push(this.evaluateExpression(_));
          }
        });

        let context = this.getCurrentContext();
        let fn = null;
        if (expr.callee.type === "StaticMemberExpression") {
          context = this.evaluateExpression(expr.callee.object);
          fn = context[expr.callee.property];
        } else if (expr.callee.type === "ComputedMemberExpression") {
          context = this.evaluateExpression(expr.callee.object);
          fn = context[this.evaluateExpression(expr.callee.expression)];
        } else {
          fn = this.evaluateExpression(expr.callee);
        }

        if (fn instanceof InterpreterFunction) {
          return fn.execute(args, context);
        } else if (typeof fn === "function") {
          return fn.apply(context, args);
        } else {
          throw new Error(`Can not execute non-function ${fn}`);
        }
      }
      case "AssignmentExpression": {
        switch (expr.binding.type) {
          case "AssignmentTargetIdentifier":
            return this.updateVariableValue(
              expr.binding,
              this.evaluateExpression(expr.expression)
            );
          case "ComputedMemberAssignmentTarget": {
            const object = this.evaluateExpression(expr.binding.object);
            const property = this.evaluateExpression(expr.binding.expression);
            const value = this.evaluateExpression(expr.expression);
            return (object[property] = value);
          }
          case "StaticMemberAssignmentTarget": {
            const object = this.evaluateExpression(expr.binding.object);
            const property = expr.binding.property;
            const value = this.evaluateExpression(expr.expression);
            return (object[property] = value);
          }
          case "ArrayAssignmentTarget":
          case "ObjectAssignmentTarget":
          default:
            return this.skipOrThrow(expr.binding.type);
        }
      }
      case "IdentifierExpression":
        return this.getVariableValue(expr);
      case "LiteralStringExpression":
      case "LiteralNumericExpression":
      case "LiteralBooleanExpression":
        return expr.value;
      case "LiteralInfinityExpression":
        return 1 / 0;
      case "LiteralNullExpression":
        return null;
      case "BinaryExpression": {
        const operation = binaryOperatorMap.get(expr.operator);
        return operation!(
          this.evaluateExpression(expr.left),
          this.evaluateExpression(expr.right)
        );
      }
      case "UpdateExpression": {
        switch (expr.operand.type) {
          case "AssignmentTargetIdentifier": {
            const currentValue = this.getVariableValue(expr.operand);
            const nextValue =
              expr.operator === "++" ? currentValue + 1 : currentValue - 1;
            // I don't know why I need to cast this. It's fine 2 lines above. VSCode bug?
            this.updateVariableValue(expr.operand as Identifier, nextValue);
            return expr.isPrefix ? nextValue : currentValue;
          }
          case "ComputedMemberAssignmentTarget": {
            const object = this.evaluateExpression(expr.operand.object);
            const property = this.evaluateExpression(expr.operand.expression);
            const currentValue = object[property];
            const nextValue =
              expr.operator === "++" ? currentValue + 1 : currentValue - 1;
            object[property] = nextValue;
            return expr.isPrefix ? nextValue : currentValue;
          }
          case "StaticMemberAssignmentTarget": {
            const object = this.evaluateExpression(expr.operand.object);
            const property = expr.operand.property;
            const currentValue = object[property];
            const nextValue =
              expr.operator === "++" ? currentValue + 1 : currentValue - 1;
            object[property] = nextValue;
            return expr.isPrefix ? nextValue : currentValue;
          }
          default:
            return;
        }
      }
      case "CompoundAssignmentExpression": {
        const operation = compoundAssignmentOperatorMap.get(expr.operator);
        switch (expr.binding.type) {
          case "AssignmentTargetIdentifier": {
            const currentValue = this.getVariableValue(expr.binding);
            return this.updateVariableValue(
              expr.binding,
              operation(currentValue, this.evaluateExpression(expr.expression))
            );
          }
          case "ComputedMemberAssignmentTarget": {
            const object = this.evaluateExpression(expr.binding.object);
            const property = this.evaluateExpression(expr.binding.expression);
            const currentValue = object[property];
            return (object[property] = operation(
              currentValue,
              this.evaluateExpression(expr.expression)
            ));
          }
          case "StaticMemberAssignmentTarget": {
            const object = this.evaluateExpression(expr.binding.object);
            const property = expr.binding.property;
            const currentValue = object[property];
            return (object[property] = operation(
              currentValue,
              this.evaluateExpression(expr.expression)
            ));
          }
          default:
            return;
        }
      }
      case "UnaryExpression": {
        const operation = unaryOperatorMap.get(expr.operator);
        if (!operation)
          return this.skipOrThrow(`${expr.type} : ${expr.operator}`);
        return operation!(this.evaluateExpression(expr.operand));
      }
      default:
        return this.skipOrThrow(expr.type);
    }
  }
}
