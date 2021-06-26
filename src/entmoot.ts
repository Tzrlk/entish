import peg from 'pegjs';
import staticGrammar from './entish.peg';

let grammar: string;
if (staticGrammar === 'entish.peg') {
  // Just so jest can access non-js resources
  const fs = require('fs');
  grammar = fs.readFileSync('./src/entish.peg').toString();
} else {
  grammar = staticGrammar;
}

type Statement = Comment | Fact | Inference | Claim | Query

type Comment = {
  type: 'comment'
  value: string
}

type Fact = {
  type: 'fact'
  table: string
  fields: Expression[]
  negative?: boolean
}

type Inference = {
  type: 'inference'
  left: Fact
  right: Conjunction | Disjunction
}

type Clause = Fact | Conjunction | Disjunction | Comparison

type Conjunction = {
  type: 'conjunction'
  clauses: Clause[]
}

type Disjunction = {
  type: 'disjunction'
  clauses: Clause[]
}

type Comparison = {
  type: 'comparison'
  operator: '=' | '>' | '<' | '>=' | '<=' | '!='
  left: Expression
  right: Expression
}

type Claim = {
  type: 'claim'
  table: string
  fields: Expression[]
  negative?: boolean
}

type Query = {
  type: 'query'
  query: Clause
}

type Expression = Function | BinaryOperation | String | Variable | Integer | Aggregation

type BinaryOperation = {
  type: 'binary_operation'
  left: Expression
  right: Expression
  operator: '+' | '-' | '*' | '/' | '^'
}

type Function = {
  type: 'function'
  function: 'floor' | 'sum'
  arguments: Expression[]
}

type String = {
  type: 'string'
  value: string
}

type Variable = {
  type: 'variable'
  value: string
}

type Integer = {
  type: 'integer'
  value: number
}

type Aggregation = {
  type: 'aggregation'
  function: 'sum'
  arguments: (string | number | Aggregation)[]
}

type Binding = {
  facts: Fact[]
  values: { [key: string]: string | number | Aggregation }
  comparisons: Comparison[]
}

class Entception extends Error { }

function groupBy<T>(array: T[], f: (o: T) => string) {
  const groups: { [key: string]: T[] } = {};
  array.forEach(o => {
    const group = f(o);
    groups[group] = groups[group] || [];
    groups[group].push(o);
  });
  return Object.keys(groups).map(group => groups[group]);
}

export default class Interpreter {

  parser: PEG.Parser;
  tables: { [key: string]: (String | Integer)[][] } = {}

  constructor() {
    this.parser = peg.generate(grammar);
  }

  exec(statement: Statement) {
    switch (statement.type) {
      case 'comment':
        return;
      case 'fact':
        this.loadFact(statement);
        console.log(`added ${factToString(statement)}`);
        return;
      case 'inference':
        console.log(`inferring ${inferenceToString(statement)}`);
        const newFacts = this.loadInference(statement);
        newFacts.forEach(f => this.loadFact(f));
        newFacts.forEach(f => console.log(`added ${factToString(f)}`));
        return;
      case 'claim':
        console.log(`testing ${claimToString(statement)}`)
        if (this.testClaim(statement) === !!statement.negative) {
          throw new Entception(`false claim: ${claimToString(statement)}`);
        } else {
          console.log(`verified ${claimToString(statement)}`);
        }
        return;
      case 'query':
        console.log(`query: ${queryToString(statement)}`);
        this.query(statement).forEach(f => console.log(`found: ${factToString(f)}`));
        return;
    }
  }

  load(input: string) {
    const statements = this.parser.parse(input).filter((x: any) => x);
    for (let line in statements) {
      const statement = statements[line];
      this.exec(statement);
    }
  }

  loadFact(fact: Fact) {
    if (fact.negative) {
      this.tables[fact.table] = this.tables[fact.table].filter(row => row.every((col, i) => fact.fields[i] === col));
      return;
    }
    if (!this.tables[fact.table]) {
      this.tables[fact.table] = [];
    }
    if (fact.fields.some(expr => expr.type !== 'string' && expr.type !== 'integer')) {
      throw new Entception(`facts must be grounded with strings or integers: ${factToString(fact)}`);
    }
    this.tables[fact.table].push(fact.fields as (String | Integer)[]);
  }

  query(query: Query): Fact[] {
    return this.searchInferenceTree(query.query).map(b => b.facts).flat();
  }

  loadInference(inference: Inference): Fact[] {
    const bindings = this.searchInferenceTree(inference.right);
    const facts = bindings.map(binding => this.ground(inference.left, binding));
    if (facts.some(fact => fact.fields.some(field => field.type === 'aggregation'))) {
      return groupBy(facts, fact => {
        return fact.fields
          .filter(f => f.type === 'string' || f.type === 'integer')
          .map(f => (f as String | Integer).value)
          .join('-');
      }).map(facts => {
        const first = facts[0];
        return {
          type: 'fact',
          table: first.table,
          fields: first.fields.map((e, i) => this.aggregate(e, i, facts))
        };
      });
    }
    return facts;
  }

  aggregate(expr: Expression, index: number, groups: Fact[]): Expression {
    switch (expr.type) {
      case 'string':
      case 'integer':
        return expr;
      case 'aggregation':
        const args = groups.map(f => {
          const field = f.fields[index];
          if (field.type !== 'aggregation') {
            throw new Entception(`TODO`);
          }
          return field.arguments;
        });
        return {
          type: 'integer',
          value: (args as number[][]).flat().reduce((n, c) => n + c, 0),
        };
      default:
        throw new Entception(`TODO`);
    }
  }

  ground(fact: Fact, binding: Binding): Fact {
    return {
      type: 'fact',
      table: fact.table,
      fields: fact.fields.map(expr => {
        const result = this.evaluateExpression(expr, binding);
        switch (typeof (result)) {
          case 'number':
            return {
              type: 'integer',
              value: result,
            };
          case 'string':
            return {
              type: 'string',
              value: result,
            };
          case 'object':
            return result;
          default:
            throw new Entception(`unknown expression result type ${typeof (result)}`);
        }
      }),
      negative: fact.negative,
    }
  }

  searchInferenceTree(clause: Clause): Binding[] {
    switch (clause.type) {
      case 'fact':
        // facts return one binding per matching row of the table
        return this.tables[clause.table].map(row => this.bind(row, clause)).filter(b => b !== undefined) as Binding[];
      case 'conjunction':
        // conjunction joins bindings into a single binding
        let rows: Binding[][] = [];
        this.join(clause.clauses.map(clause => this.searchInferenceTree(clause)), [], rows);
        return rows.map(bindings => this.reduceBindings(bindings)).filter(b => b !== undefined) as Binding[];
      case 'disjunction':
        // disjunction concatenates bindings
        return clause.clauses.map(clause => this.searchInferenceTree(clause)).flat();
      case 'comparison':
        return [{
          facts: [] as Fact[],
          values: {},
          comparisons: [clause],
        }];
    }
  }

  join(bindings: Binding[][], group: Binding[], result: Binding[][]) {
    if (bindings.length === 0) {
      result.push(group)
      return
    }
    const first = bindings[0];
    const rest = bindings.slice(1);
    for (let binding of first) {
      this.join(rest, group.concat([binding]), result);
    }
  }

  // reduce joins bindings together where same-named variables match
  // it discards non-matching bindings (i.e. bindings that "disagree on the facts")
  reduceBindings(bindings: Binding[]): Binding | undefined {
    try {
      return bindings.reduce((current, binding) => {
        Object.keys(current.values).forEach(key => {
          if (binding.values[key] && binding.values[key] !== current.values[key]) {
            throw new Entception(`bindings disagree: ${binding.values[key]} != ${current.values[key]}`);
          }
        });
        const newBinding = {
          facts: current.facts.concat(binding.facts),
          values: Object.assign(current.values, binding.values),
          comparisons: [],
        };
        binding.comparisons.forEach(comparison => {
          if (!this.compare(comparison, newBinding)) {
            throw new Entception(`false comparison: ${clauseToString(comparison)}, ${newBinding.values}`);
          }
        });
        return newBinding;
      }, {
        facts: [],
        values: {},
        comparisons: [],
      } as Binding);
    } catch (e) {
      if (!(e instanceof Entception)) throw e;
      return undefined;
    }
  }

  bind(constants: (String | Integer)[], clause: Fact): Binding | undefined {
    const bindings = constants.map((value, i) => {
      const field = clause.fields[i];
      switch (field.type) {
        case 'string':
        case 'integer':
          if (value.value !== field.value) {
            return false;
          }
          return [`${clause.table}[${i}]`, value.value];
        case 'variable':
          if (field.value === '?') {
            return [`${clause.table}[${i}]`, value.value];
          }
          return [field.value, value.value];
        default:
          throw new Entception(`can't handle ${field.type} ${expressionToString(field)} in clause`);
      }
    });
    if (bindings.some(v => !v)) return undefined;
    return {
      facts: [{
        type: 'fact',
        table: clause.table,
        fields: constants,
      }],
      values: Object.fromEntries(bindings as Iterable<readonly [PropertyKey, string | number]>),
      comparisons: [],
    };
  }

  compare(comparison: Comparison, binding: Binding): boolean {
    const left = this.evaluateExpression(comparison.left, binding);
    const right = this.evaluateExpression(comparison.right, binding);
    if (left instanceof Object || right instanceof Object) {
      throw new Error("can't compare aggregations"); // TODO
    }
    switch (comparison.operator) {
      case '=':
        return left === right;
      case '!=':
        return left !== right;
      case '>':
        return left > right;
      case '>=':
        return left >= right;
      case '<':
        return left < right;
      case '<=':
        return left <= right;
    }
  }

  testClaim(claim: Claim): boolean {
    const table = this.tables[claim.table];
    if (table) {
      for (const row of table) {
        if (row.length !== claim.fields.length) continue;
        if (claim.fields.every((field, i) => field.type === row[i].type && field.value === row[i].value)) { return true }
      }
    }
    return false;
  }

  evaluateFunction(fn: Function, binding: Binding): string | number | Aggregation {
    switch (fn.function) {
      case 'floor':
        const arg = this.evaluateExpression(fn.arguments[0], binding);
        if (typeof (arg) !== 'number') {
          throw new Entception(`floor requires numeric argument, got ${arg}`);
        }
        return Math.floor(arg);
      case 'sum':
        return {
          type: 'aggregation',
          function: 'sum',
          arguments: fn.arguments.map(expr => this.evaluateExpression(expr, binding)),
        };
      default:
        throw new Entception(`can't handle function ${fn.function}`)
    }
  }

  evaluateBinaryOperation(op: BinaryOperation, binding: Binding): number {
    const left = this.evaluateExpression(op.left, binding);
    if (typeof (left) !== 'number') {
      throw new Entception(`binary operation requires number on left-hand side, got ${left}`);
    }
    const right = this.evaluateExpression(op.right, binding);
    if (typeof (right) !== 'number') {
      throw new Entception(`binary operation requires number on right-hand side, got ${right}`);
    }
    switch (op.operator) {
      case '+':
        return left + right;
      case '-':
        return left - right;
      case '/':
        return left / right;
      case '*':
        return left * right;
      case '^':
        return Math.pow(left, right);
    }
  }

  evaluateExpression(expr: Expression, binding: Binding): string | number | Aggregation {
    switch (expr.type) {
      case 'binary_operation':
        return this.evaluateBinaryOperation(expr, binding);
      case 'function':
        return this.evaluateFunction(expr, binding);
      case 'variable':
        return binding.values[expr.value];
      case 'string':
      case 'integer':
        return expr.value;
      case 'aggregation':
        return expr;
    }
  }
}

export function statementToString(stmt: Statement): string {
  switch (stmt.type) {
    case 'claim':
      return claimToString(stmt);
    case 'inference':
      return inferenceToString(stmt);
    case 'query':
      return queryToString(stmt);
    default:
      return `[${stmt.type}]`;
  }
}

function inferenceToString(inf: Inference): string {
  return `${factToString(inf.left)} :- ${clauseToString(inf.right)}.`
}

function queryToString(q: Query): string {
  return `${clauseToString(q.query)}?`;
}

function factToString(fact: Fact): string {
  return `${fact.negative ? '~' : ''}${fact.table}(${fact.fields.map(e => expressionToString(e)).join(', ')})`;
}

function clauseToString(clause: Clause): string {
  switch (clause.type) {
    case 'fact':
      return factToString(clause);
    case 'conjunction':
      return '(' + clause.clauses.map(c => clauseToString(c)).join(' & ') + ')';
    case 'disjunction':
      return '(' + clause.clauses.map(c => clauseToString(c)).join(' | ') + ')';
    case 'comparison':
      return `${expressionToString(clause.left)} ${clause.operator} ${expressionToString(clause.right)}`;
  }
}

function expressionToString(expr: Expression): string {
  switch (expr.type) {
    case 'string':
      return expr.value;
    case 'integer':
      return expr.value.toString();
    case 'variable':
      return expr.value;
    case 'binary_operation':
      return `${expressionToString(expr.left)} ${expr.operator} ${expressionToString(expr.right)}`;
    case 'function':
      return `${expr.function}(${expr.arguments.map(e => expressionToString(e)).join(', ')})`;
    case 'aggregation':
      return `${expr.function}(${expr.arguments.map(e => {
        if (typeof (e) === 'object') return expressionToString(e);
        return e;
      }).join(', ')})`;
  }
}

function claimToString(claim: Claim): string {
  return `∴ ${factToString(claim as unknown as Fact)}`;
}
