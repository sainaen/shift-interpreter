import { Script } from 'shift-ast';
import { parseScript } from 'shift-parser';
import { Interpreter } from './interpreter';

export function interpretSource(source: string, context = {}) {
  return interpretTree(parseScript(source), context);
}

export function interpretTree(tree: Script, context = {}) {
  const interpreter = new Interpreter();
  interpreter.load(tree);
  interpreter.pushContext(context);
  return interpreter.run();
}

export default interpretSource;

export const interpret = interpretSource;

export { Interpreter } from './interpreter';
export { RuntimeValue } from './runtime-value';
