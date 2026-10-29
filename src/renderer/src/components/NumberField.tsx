// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react'

/** An integer input that only reports values within [min, max]; the text resets on blur. */
function NumberField(p: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}): React.JSX.Element {
  const [text, setText] = useState(String(p.value))
  const [prev, setPrev] = useState(p.value)
  if (p.value !== prev) {
    setPrev(p.value)
    setText(String(p.value))
  }
  return (
    <label className="num-field">
      <span>{p.label}</span>
      <input
        type="number"
        min={p.min}
        max={p.max}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const n = Number(e.target.value)
          if (e.target.value !== '' && Number.isInteger(n) && n >= p.min && n <= p.max)
            p.onChange(n)
        }}
        onBlur={() => setText(String(p.value))}
      />
    </label>
  )
}

export default NumberField
