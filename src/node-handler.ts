import DEBUG from 'debug';
import {
  ArrayExpression,
  ArrowExpression,
  AssignmentExpression,
  BinaryExpression,
  Block,
  BlockStatement,
  CallExpression,
  ClassDeclaration,
  CompoundAssignmentExpression,
  ComputedMemberExpression,
  ConditionalExpression,
  DoWhileStatement,
  ExpressionStatement,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  FunctionBody,
  FunctionDeclaration,
  FunctionExpression,
  IdentifierExpression,
  IfStatement,
  LiteralBooleanExpression,
  LiteralInfinityExpression,
  LiteralNullExpression,
  LiteralNumericExpression,
  LiteralRegExpExpression,
  LiteralStringExpression,
  NewExpression,
  ObjectExpression,
  ReturnStatement,
  Script,
  StaticMemberExpression,
  TemplateExpression,
  ThisExpression,
  ThrowStatement,
  TryCatchStatement,
  TryFinallyStatement,
  UnaryExpression,
  UpdateExpression,
  VariableDeclarationStatement,
  VariableDeclarator,
  WhileStatement,
} from 'shift-ast';
import { BasicContext } from './context';
import { InterpreterRuntimeError } from './errors';
import { Interpreter } from './interpreter';
import { binaryOperatorMap, compoundAssignmentOperatorMap, unaryOperatorMap } from './operators';
import { toString } from './util';
import { Variable } from 'shift-scope';

export interface DynamicClass {
  [key: string]: any;
}

const debug = DEBUG('shift:interpreter:node-handler');

export class NodeHandler {
  interpreter: Interpreter;

  constructor(interpreter: Interpreter) {
    this.interpreter = interpreter;
  }

  ReturnStatement(stmt: ReturnStatement) {
    const value = this.interpreter.evaluate(stmt.expression);
    this.interpreter.isReturning(true);
    return value;
  }

  ExpressionStatement(stmt: ExpressionStatement) {
    return this.interpreter.evaluate(stmt.expression);
  }
  VariableDeclarationStatement(stmt: VariableDeclarationStatement) {
    return this.interpreter.declareVariables(stmt.declaration);
  }

  VariableDeclarator(declarator: VariableDeclarator) {
    const value = this.interpreter.evaluate(declarator.init);
    return this.interpreter.bindVariable(declarator.binding, value);
  }

  FunctionDeclaration(decl: FunctionDeclaration) {
    const fn = this.interpreter.createFunction(decl);

    const variables = this.interpreter.lookupTable.variableMap.get(decl.name);
    variables.forEach((variable: Variable) => this.interpreter.variableMap.set(variable, fn));
  }

  BlockStatement(stmt: BlockStatement) {
    return this.interpreter.evaluate(stmt.block);
  }

  ClassDeclaration(decl: ClassDeclaration) {
    const staticMethods: [string, Function][] = [];
    const methods: [string, Function][] = [];
    let constructor: null | Function = null;

    if (decl.elements.length > 0) {
      for (let el of decl.elements) {
        if (el.method.type === 'Method') {
          const intermediateFunction = this.interpreter.createFunction(el.method);
          if (el.isStatic) {
            staticMethods.push([intermediateFunction.name!, intermediateFunction]);
          } else {
            if (intermediateFunction.name === 'constructor') constructor = intermediateFunction;
            else methods.push([intermediateFunction.name!, intermediateFunction]);
          }
        } else {
          this.interpreter.skipOrThrow(`ClassElement type ${el.method.type}`);
        }
      }
    }

    let Class: DynamicClass = class {};

    if (decl.super) {
      const xtends = this.interpreter.evaluate(decl.super);
      Class = ((SuperClass: any = xtends) => {
        if (constructor === null) {
          class InterpreterClassWithExtendsA extends SuperClass {
            constructor(...args: any) {
              super(...args);
            }
          }

          return InterpreterClassWithExtendsA;
        } else {
          class InterpreterClassWithExtendsB extends SuperClass {
            constructor(...args: any) {
              super(...args);
              constructor!(args, this);
            }
          }

          return InterpreterClassWithExtendsB;
        }
      })();
    } else {
      Class = (() => {
        if (constructor === null) {
          class InterpreterClassA {
            constructor() {}
          }

          return InterpreterClassA;
        } else {
          class InterpreterClassB {
            constructor(...args: any) {
              constructor!(args, this);
            }
          }

          return InterpreterClassB;
        }
      })();
    }

    methods.forEach(([name, intermediateFunction]) => {
      Class.prototype[name] = intermediateFunction;
    });

    staticMethods.forEach(([name, intermediateFunction]) => {
      Class[name] = intermediateFunction;
    });

    const variables = this.interpreter.lookupTable.variableMap.get(decl.name);

    variables.forEach((variable: any) => this.interpreter.variableMap.set(variable, Class));

    return Class;
  }

  IfStatement(stmt: IfStatement) {
    const test = this.interpreter.evaluate(stmt.test);
    if (test) return this.interpreter.evaluate(stmt.consequent);
    else if (stmt.alternate) return this.interpreter.evaluate(stmt.alternate);
  }

  ConditionalExpression(stmt: ConditionalExpression) {
    const test = this.interpreter.evaluate(stmt.test);
    if (test) return this.interpreter.evaluate(stmt.consequent);
    else if (stmt.alternate) return this.interpreter.evaluate(stmt.alternate);
  }

  ThrowStatement(stmt: ThrowStatement) {
    const error = this.interpreter.evaluate(stmt.expression);
    throw error;
  }

  TryCatchStatement(stmt: TryCatchStatement) {
    let returnValue = undefined;
    try {
      returnValue = this.interpreter.evaluate(stmt.body);
    } catch (e) {
      this.interpreter.bindVariable(stmt.catchClause.binding, e);
      try {
        returnValue = this.interpreter.evaluate(stmt.catchClause.body);
      } catch (e) {
        throw e;
      }
    }
    return returnValue;
  }

  TryFinallyStatement(stmt: TryFinallyStatement) {
    let returnValue = undefined;
    if (stmt.catchClause) {
      try {
        returnValue = this.interpreter.evaluate(stmt.body);
      } catch (e) {
        this.interpreter.bindVariable(stmt.catchClause.binding, e);
        try {
          returnValue = this.interpreter.evaluate(stmt.catchClause.body);
        } catch (e) {
          throw e;
        }
      } finally {
        returnValue = this.interpreter.evaluate(stmt.finalizer);
      }
    } else {
      try {
        returnValue = this.interpreter.evaluate(stmt.body);
      } finally {
        returnValue = this.interpreter.evaluate(stmt.finalizer);
      }
    }
    return returnValue;
  }

  Block(block: Block) {
    let value;
    const _debug = debug.extend('Block');

    this.interpreter.hoistFunctions(block);
    this.interpreter.hoistVars(block);
    const statements = block.statements.filter(stmt => stmt.type !== 'FunctionDeclaration');

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      _debug(`Evaluating next ${statement.type} in ${block.type}`);
      value = this.interpreter.evaluate(statement);
      _debug(`${block.type} statement ${statement.type} completed`);
    }
    _debug(`completed ${block.type}, returning with: ${value}`);
    return value;
  }

  FunctionBody(body: FunctionBody) {
    let value;
    const _debug = debug.extend(body.type);

    this.interpreter.hoistFunctions(body);
    this.interpreter.hoistVars(body);
    const statements = body.statements.filter(stmt => stmt.type !== 'FunctionDeclaration');

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      _debug(`Evaluating ${statement.type} in ${body.type}`);
      value = this.interpreter.evaluate(statement);
      _debug(`${body.type} statement ${statement.type} completed`);
      if (this.interpreter.isReturning()) {
        break;
      }
    }
    _debug(`completed ${body.type}, returning with: ${value}`);
    return value;
  }

  Script(body: Script) {
    let value;
    const _debug = debug.extend(body.type);

    this.interpreter.hoistFunctions(body);
    this.interpreter.hoistVars(body);
    const statements = body.statements.filter(stmt => stmt.type !== 'FunctionDeclaration');

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      _debug(`Evaluating ${statement.type} in ${body.type}`);
      value = this.interpreter.evaluate(statement);
      _debug(`${body.type} statement ${statement.type} completed`);
    }
    _debug(`completed ${body.type}, returning with: ${value}`);
    return value;
  }
  loopBlock(stmt: ForOfStatement | ForInStatement | ForStatement | WhileStatement | DoWhileStatement) {
    const _debug = debug.extend(stmt.type);
    let statements = null;
    if (stmt.body.type === 'BlockStatement') {
      this.interpreter.hoistFunctions(stmt.body.block);
      this.interpreter.hoistVars(stmt.body.block);
      statements = stmt.body.block.statements.filter(stmt => stmt.type !== 'FunctionDeclaration');
    } else {
      statements = [stmt.body];
    }
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      _debug(`Evaluating ${statement.type} in ${stmt.type}`);
      this.interpreter.evaluate(statement);
      _debug(`${stmt.type} statement ${statement.type} completed`);
      if (this.interpreter.isBreaking()) {
        break;
      }
      if (this.interpreter.isContinuing()) {
        break;
      }
    }
  }
  ForOfStatement(stmt: ForOfStatement) {
    const iterationExpression = this.interpreter.evaluate(stmt.right);
    function* nextValue() {
      yield* iterationExpression;
    }
    let iterator = nextValue();
    let result = null;

    while ((result = iterator.next())) {
      if (result.done) break;
      const { value } = result;
      switch (stmt.left.type) {
        case 'VariableDeclaration': {
          this.interpreter.declareVariables(stmt.left);
          const binding = stmt.left.declarators[0].binding;
          if (binding.type === 'BindingIdentifier') this.interpreter.updateVariableValue(binding, value);
          else this.interpreter.skipOrThrow(stmt.type + '.left->' + binding.type);
          break;
        }
        default:
          this.interpreter.skipOrThrow(stmt.type + '.left->' + stmt.left.type);
      }
      this.loopBlock(stmt);
      if (this.interpreter.isContinuing()) {
        this.interpreter.isContinuing(false);
        continue;
      }
      if (this.interpreter.isBreaking()) {
        this.interpreter.isBreaking(false);
        break;
      }
    }
  }

  ForInStatement(stmt: ForInStatement) {
    const iterationExpression = this.interpreter.evaluate(stmt.right);

    switch (stmt.left.type) {
      case 'VariableDeclaration': {
        this.interpreter.declareVariables(stmt.left);
        const binding = stmt.left.declarators[0].binding;
        for (let a in iterationExpression) {
          if (binding.type === 'BindingIdentifier') this.interpreter.updateVariableValue(binding, a);
          else this.interpreter.skipOrThrow(stmt.type + '.left->' + binding.type);
          this.loopBlock(stmt);
          if (this.interpreter.isContinuing()) {
            this.interpreter.isContinuing(false);
            continue;
          }
          if (this.interpreter.isBreaking()) {
            this.interpreter.isBreaking(false);
            break;
          }
        }
        break;
      }
      case 'AssignmentTargetIdentifier': {
        for (let a in iterationExpression) {
          this.interpreter.updateVariableValue(stmt.left, a);
          this.loopBlock(stmt);
          if (this.interpreter.isContinuing()) {
            this.interpreter.isContinuing(false);
            continue;
          }
          if (this.interpreter.isBreaking()) {
            this.interpreter.isBreaking(false);
            break;
          }
        }
        break;
      }
      default:
        this.interpreter.skipOrThrow(stmt.type + '.left->' + stmt.left.type);
    }
  }

  ForStatement(stmt: ForStatement) {
    if (stmt.init) {
      if (stmt.init.type === 'VariableDeclaration') this.interpreter.declareVariables(stmt.init);
      else this.interpreter.evaluate(stmt.init);
    }
    while (this.interpreter.evaluate(stmt.test)) {
      this.loopBlock(stmt);
      if (this.interpreter.isBreaking()) {
        this.interpreter.isBreaking(false);
        break;
      }
      if (stmt.update) this.interpreter.evaluate(stmt.update);
      if (this.interpreter.isContinuing()) {
        this.interpreter.isContinuing(false);
        continue;
      }
    }
  }

  WhileStatement(stmt: WhileStatement) {
    while (this.interpreter.evaluate(stmt.test)) {
      this.loopBlock(stmt);
      if (this.interpreter.isContinuing()) {
        this.interpreter.isContinuing(false);
        continue;
      }
      if (this.interpreter.isBreaking()) {
        this.interpreter.isBreaking(false);
        break;
      }
    }
  }

  DoWhileStatement(stmt: DoWhileStatement) {
    do {
      this.loopBlock(stmt);
      if (this.interpreter.isContinuing()) {
        this.interpreter.isContinuing(false);
        continue;
      }
      if (this.interpreter.isBreaking()) {
        this.interpreter.isBreaking(false);
        break;
      }
    } while (this.interpreter.evaluate(stmt.test));
  }

  ThisExpression(expr: ThisExpression) {
    return this.interpreter.getCurrentContext();
  }

  NewExpression(expr: NewExpression) {
    const newTarget = this.interpreter.evaluate(expr.callee);
    const args: any[] = [];
    for (let arg of expr.arguments) {
      if (arg.type === 'SpreadElement') {
        const value = this.interpreter.evaluate(arg.expression);
        args.push(...value);
      } else {
        args.push(this.interpreter.evaluate(arg));
      }
    }
    let result = new newTarget(...args);

    return result;
  }

  ArrayExpression(expr: ArrayExpression) {
    const elements = [];
    for (let el of expr.elements) {
      if (el === null) {
        elements.push(null);
      } else if (el.type === 'SpreadElement') {
        const iterable = this.interpreter.evaluate(el.expression);
        elements.push(...Array.from(iterable));
      } else {
        elements.push(this.interpreter.evaluate(el));
      }
    }
    return elements;
  }

  ObjectExpression(expr: ObjectExpression) {
    const _debug = debug.extend('ObjectExpression');
    const obj: { [key: string]: any } = {};
    const batchOperations: Map<string, Map<string, () => any>> = new Map();
    function getPropertyDescriptors(name: string) {
      if (batchOperations.has(name)) return batchOperations.get(name)!;
      const operations = new Map();
      batchOperations.set(name, operations);
      return operations;
    }
    for (let prop of expr.properties) {
      switch (prop.type) {
        case 'DataProperty': {
          const name =
            prop.name.type === 'StaticPropertyName' ? prop.name.value : this.interpreter.evaluate(prop.name.expression);
          obj[name] = this.interpreter.evaluate(prop.expression);
          break;
        }
        case 'Method': {
          const name =
            prop.name.type === 'StaticPropertyName' ? prop.name.value : this.interpreter.evaluate(prop.name.expression);
          obj[name] = this.interpreter.createFunction(prop);
          break;
        }
        case 'ShorthandProperty': {
          const name = prop.name.name;
          obj[name] = this.interpreter.getRuntimeValue(prop.name);
          break;
        }
        case 'Getter': {
          const name =
            prop.name.type === 'StaticPropertyName' ? prop.name.value : this.interpreter.evaluate(prop.name.expression);
          const operations = getPropertyDescriptors(name);
          operations.set('get', this.interpreter.createFunction(prop));
          break;
        }
        case 'Setter': {
          const name =
            prop.name.type === 'StaticPropertyName' ? prop.name.value : this.interpreter.evaluate(prop.name.expression);
          const operations = getPropertyDescriptors(name);
          operations.set('set', this.interpreter.createFunction(prop));
          break;
        }
        default:
          this.interpreter.skipOrThrow(`${expr.type}[${prop.type}]`);
      }
    }

    Array.from(batchOperations.entries()).forEach(([prop, ops]) => {
      _debug(`setting object property ${prop} (setter:${ops.has('set')}, getter:${ops.has('get')})`);
      const descriptor: PropertyDescriptor = {
        get: ops.get('get'),
        set: ops.get('set'),
        configurable: true,
      };
      Object.defineProperty(obj, prop, descriptor);
    });

    return obj;
  }

  StaticMemberExpression(expr: StaticMemberExpression) {
    if (expr.object.type === 'Super') return this.interpreter.skipOrThrow(expr.object.type);
    const object = this.interpreter.evaluate(expr.object);
    let result = object[expr.property];
    return result;
  }

  ComputedMemberExpression(expr: ComputedMemberExpression) {
    if (expr.object.type === 'Super') return this.interpreter.skipOrThrow(expr.object.type);
    const object = this.interpreter.evaluate(expr.object);
    const property = this.interpreter.evaluate(expr.expression);
    let result = object[property];
    return result;
  }

  CallExpression(expr: CallExpression) {
    const _debug = debug.extend('CallExpression');
    if (expr.callee.type === 'Super') return this.interpreter.skipOrThrow(expr.callee.type);

    const args: any[] = [];
    for (let arg of expr.arguments) {
      if (arg.type === 'SpreadElement') {
        const value = this.interpreter.evaluate(arg.expression);
        args.push(...value);
      } else {
        args.push(this.interpreter.evaluate(arg));
      }
    }

    let context = this.interpreter.getCurrentContext();
    let fn = null;
    if (expr.callee.type === 'StaticMemberExpression') {
      context = this.interpreter.evaluate(expr.callee.object);
      fn = context[expr.callee.property];
    } else if (expr.callee.type === 'ComputedMemberExpression') {
      context = this.interpreter.evaluate(expr.callee.object);
      const computedProperty = this.interpreter.evaluate(expr.callee.expression);
      fn = context[computedProperty];
    } else {
      fn = this.interpreter.evaluate(expr.callee);
    }

    if (typeof fn === 'function') {
      let returnValue: any;
      _debug(`calling function ${fn.name}`);
      returnValue = fn.apply(context, args);
      _debug(`function completed ${fn.name}`);
      return returnValue;
    } else {
      new TypeError(`${fn} is not a function (${this.interpreter.codegen(expr)})`);
    }
  }

  AssignmentExpression(expr: AssignmentExpression) {
    const _debug = debug.extend('AssignmentExpression');
    switch (expr.binding.type) {
      case 'AssignmentTargetIdentifier':
        _debug(`assigning ${expr.binding.name} new value`);
        return this.interpreter.updateVariableValue(expr.binding, this.interpreter.evaluate(expr.expression));
      case 'ComputedMemberAssignmentTarget': {
        const object = this.interpreter.evaluate(expr.binding.object);
        const property = this.interpreter.evaluate(expr.binding.expression);
        _debug(`evaluating expression ${expr.expression.type} to assign to ${toString(property)}`);
        const value = this.interpreter.evaluate(expr.expression);
        _debug(`assigning object property "${toString(property)}" new value`);
        let result = (object[property] = value);

        return result;
      }
      case 'StaticMemberAssignmentTarget': {
        const object = this.interpreter.evaluate(expr.binding.object);
        const property = expr.binding.property;
        _debug(`evaluating expression ${expr.expression.type} to assign to ${property}`);
        const value = this.interpreter.evaluate(expr.expression);
        _debug(`assigning object property "${property}" new value`);
        const descriptor = Object.getOwnPropertyDescriptor(object, property);

        let result = null;
        result = object[property] = value;
        return result;
      }
      case 'ArrayAssignmentTarget':
      case 'ObjectAssignmentTarget':
      default:
        return this.interpreter.skipOrThrow(expr.binding.type);
    }
  }

  UpdateExpression(expr: UpdateExpression) {
    switch (expr.operand.type) {
      case 'AssignmentTargetIdentifier': {
        const currentValue = this.interpreter.getRuntimeValue(expr.operand);
        const nextValue = expr.operator === '++' ? currentValue + 1 : currentValue - 1;
        this.interpreter.updateVariableValue(expr.operand, nextValue);
        return expr.isPrefix ? nextValue : currentValue;
      }
      case 'ComputedMemberAssignmentTarget': {
        const object = this.interpreter.evaluate(expr.operand.object);
        const property = this.interpreter.evaluate(expr.operand.expression);
        const currentValue = object[property];
        const nextValue = expr.operator === '++' ? currentValue + 1 : currentValue - 1;
        object[property] = nextValue;
        return expr.isPrefix ? nextValue : currentValue;
      }
      case 'StaticMemberAssignmentTarget': {
        const object = this.interpreter.evaluate(expr.operand.object);
        const property = expr.operand.property;
        const currentValue = object[property];
        const nextValue = expr.operator === '++' ? currentValue + 1 : currentValue - 1;
        object[property] = nextValue;
        return expr.isPrefix ? nextValue : currentValue;
      }
      default:
        return;
    }
  }

  CompoundAssignmentExpression(expr: CompoundAssignmentExpression) {
    const operation = compoundAssignmentOperatorMap.get(expr.operator);
    switch (expr.binding.type) {
      case 'AssignmentTargetIdentifier': {
        const currentValue = this.interpreter.getRuntimeValue(expr.binding);
        const newValue = this.interpreter.evaluate(expr.expression);
        return this.interpreter.updateVariableValue(expr.binding, operation(currentValue, newValue));
      }
      case 'ComputedMemberAssignmentTarget': {
        const object = this.interpreter.evaluate(expr.binding.object);
        const property = this.interpreter.evaluate(expr.binding.expression);
        const currentValue = object[property];
        const newValue = this.interpreter.evaluate(expr.expression);
        const result = (object[property] = operation(currentValue, newValue));
        return result;
      }
      case 'StaticMemberAssignmentTarget': {
        const object = this.interpreter.evaluate(expr.binding.object);
        const property = expr.binding.property;
        const currentValue = object[property];
        const newValue = this.interpreter.evaluate(expr.expression);
        const result = (object[property] = operation(currentValue, newValue));
        return result;
      }
      default:
        return;
    }
  }

  LiteralRegExpExpression(expr: LiteralRegExpExpression) {
    const flags = [
      expr.global ? 'g' : '',
      expr.ignoreCase ? 'i' : '',
      expr.dotAll ? 's' : '',
      expr.multiLine ? 'm' : '',
      expr.sticky ? 'y' : '',
      expr.unicode ? 'u' : '',
    ].filter(_ => !!_);
    return new RegExp(expr.pattern, ...flags);
  }

  TemplateExpression(expr: TemplateExpression) {
    const parts = [];
    for (let el of expr.elements) {
      if (el.type === 'TemplateElement') {
        parts.push(el.rawValue);
      } else {
        parts.push(this.interpreter.evaluate(el));
      }
    }
    return parts.join('');
  }

  ArrowExpression(expr: ArrowExpression) {
    const interpreter = this.interpreter;
    const currentContext = interpreter.getCurrentContext();

    return function(this: BasicContext) {
      const arrowFn = (...args: any) => {
        interpreter.pushContext(this);
        for (let i = 0; i < expr.params.items.length; i++) {
          let param = expr.params.items[i];
          interpreter.bindVariable(param, args[i]);
        }
        let returnValue = undefined;
        if (expr.body.type === 'FunctionBody') {
          const blockResult = interpreter.evaluate(expr.body);
          returnValue = blockResult;
        } else {
          returnValue = interpreter.evaluate(expr.body);
        }
        interpreter.popContext();
        return returnValue;
      };
      Object.assign(arrowFn);
      return arrowFn;
    }.bind(currentContext)();
  }
  FunctionExpression(expr: FunctionExpression) {
    return this.interpreter.createFunction(expr);
  }
  IdentifierExpression(expr: IdentifierExpression) {
    return this.interpreter.getRuntimeValue(expr);
  }
  LiteralNumericExpression(expr: LiteralNumericExpression) {
    return expr.value;
  }
  LiteralStringExpression(expr: LiteralStringExpression) {
    return expr.value;
  }
  LiteralBooleanExpression(expr: LiteralBooleanExpression) {
    return expr.value;
  }
  LiteralInfinityExpression(expr?: LiteralInfinityExpression) {
    return 1 / 0;
  }
  LiteralNullExpression(expr?: LiteralNullExpression) {
    return null;
  }
  BinaryExpression(expr: BinaryExpression) {
    const operation = binaryOperatorMap.get(expr.operator);
    const left = this.interpreter.evaluate(expr.left);
    const deferredRight = () => {
      return this.interpreter.evaluate(expr.right);
    };
    return operation(left, deferredRight);
  }
  UnaryExpression(expr: UnaryExpression) {
    const operation = unaryOperatorMap.get(expr.operator);
    if (!operation) return this.interpreter.skipOrThrow(`${expr.type} : ${expr.operator}`);
    try {
      const operand = this.interpreter.evaluate(expr.operand);
      return operation(operand);
    } catch (e) {
      if (e instanceof ReferenceError && expr.operator === 'typeof' && expr.operand.type === 'IdentifierExpression') {
        return 'undefined';
      }
      throw e;
    }
  }

  BreakStatement(...args: any) {
    this.interpreter.isBreaking(true);
  }
  ContinueStatement(...args: any) {
    this.interpreter.isContinuing(true);
  }
  DebuggerStatement(...args: any) {
    debugger;
  }

  EmptyStatement(...args: any) {}

  // TODO support these nodes
  WithStatement(...args: any) {
    throw new InterpreterRuntimeError(`Unsupported node ${arguments[0].type}`);
  }
  SwitchStatementWithDefault(...args: any) {
    throw new InterpreterRuntimeError(`Unsupported node ${arguments[0].type}`);
  }
  SwitchStatement(...args: any) {
    throw new InterpreterRuntimeError(`Unsupported node ${arguments[0].type}`);
  }
  LabeledStatement(...args: any) {
    throw new InterpreterRuntimeError(`Unsupported node ${arguments[0].type}`);
  }
  ForAwaitStatement(...args: any) {
    throw new InterpreterRuntimeError(`Unsupported node ${arguments[0].type}`);
  }
  NewTargetExpression(...args: any) {
    throw new InterpreterRuntimeError(`Unsupported node ${arguments[0].type}`);
  }
  AwaitExpression(...args: any) {
    throw new InterpreterRuntimeError(`Unsupported node ${arguments[0].type}`);
  }
  Super(...args: any) {
    throw new InterpreterRuntimeError(`Unsupported node ${arguments[0].type}`);
  }
  ClassExpression(...args: any) {
    throw new InterpreterRuntimeError(`Unsupported node ${arguments[0].type}`);
  }
  YieldExpression(...args: any) {
    throw new InterpreterRuntimeError(`Unsupported node ${arguments[0].type}`);
  }
  YieldGeneratorExpression(...args: any) {
    throw new InterpreterRuntimeError(`Unsupported node ${arguments[0].type}`);
  }
}
