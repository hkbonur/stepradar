/**
 * Repository-specific oxlint rules, enabled in `.oxlintrc.json` as `studio/<rule>`.
 *
 * Each rule is an ESLint selector (https://eslint.org/docs/latest/extend/selectors)
 * plus a message: every node the selector matches is reported. To add a rule,
 * add an entry to `rules`, enable it in `.oxlintrc.json`, and list it in the
 * "Enforced by oxlint" table in `.claude/skills/coding-rules/SKILL.md`.
 */

// ---------------------------------------------------------------------------
// studio/no-destructure-props — components read `props.x`
// ---------------------------------------------------------------------------

// A component is a function named in PascalCase (`function Button`), or any
// function assigned to a PascalCase const (`const Button = () => ...`).
const COMPONENT = ':matches(:function[id.name=/^[A-Z]/], VariableDeclarator[id.name=/^[A-Z]/] > :function)'

const noDestructureProps = {
  // `ObjectPattern.params`: a destructuring pattern in the parameter list.
  selector: `${COMPONENT} > ObjectPattern.params`,
  message: 'Take `props` and read `props.x`; do not destructure the parameter.',
  // Components live in .tsx files, so a PascalCase function in a .ts file is not one.
  files: /\.tsx$/,
}

// ---------------------------------------------------------------------------
// studio/cn-object-syntax — conditional classes in cn() are objects
// ---------------------------------------------------------------------------

const CN_ARGUMENT = "CallExpression[callee.name='cn'] >"

// `cond && 'class'`
const AND_CLASS = "LogicalExpression[operator='&&']"

// `cond ? 'class' : ''` or `cond ? '' : 'class'`. A ternary between two
// classes is fine: the object form would need two keys for the same choice.
const TERNARY_WITH_EMPTY_BRANCH = "ConditionalExpression[consequent.value=''], ConditionalExpression[alternate.value='']"

const cnObjectSyntax = {
  selector: `${CN_ARGUMENT} :matches(${AND_CLASS}, ${TERNARY_WITH_EMPTY_BRANCH})`,
  message: 'Write `{ "class": condition }` in `cn()` instead of `&&` or a ternary with an empty branch.',
}

// ---------------------------------------------------------------------------
// studio/no-jsx-ternary-null — render with `cond && <X />`, not `cond ? <X /> : null`
// ---------------------------------------------------------------------------

// A ternary whose only non-null branch is JSX has one real outcome: render it
// or render nothing. `cond && <X />` says that directly; the ternary doesn't.
const consequentJsxAlternateNull =
  "ConditionalExpression:matches([consequent.type='JSXElement'], [consequent.type='JSXFragment'])[alternate.value=null]"
const alternateJsxConsequentNull =
  "ConditionalExpression:matches([alternate.type='JSXElement'], [alternate.type='JSXFragment'])[consequent.value=null]"

const noJsxTernaryNull = {
  selector: `${consequentJsxAlternateNull}, ${alternateJsxConsequentNull}`,
  message: 'Use `cond && <X />`, not `cond ? <X /> : null` (or the reverse), when one branch is always null.',
}

// ---------------------------------------------------------------------------

/** Turns `{ selector, message, files? }` into an oxlint rule. */
function toRule(definition) {
  return {
    create(context) {
      if (definition.files && !definition.files.test(context.filename)) return {}
      return {
        [definition.selector]: (node) => context.report({ node, message: definition.message }),
      }
    },
  }
}

export default {
  meta: { name: 'studio' },
  rules: {
    'no-destructure-props': toRule(noDestructureProps),
    'cn-object-syntax': toRule(cnObjectSyntax),
    'no-jsx-ternary-null': toRule(noJsxTernaryNull),
  },
}
