'use client'

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styles from './ThemedSelect.module.css'

export interface ThemedSelectOption {
  value: string
  label: ReactNode
  disabled?: boolean
}

export interface ThemedSelectGroup {
  label: string
  options: ThemedSelectOption[]
}

export type ThemedSelectItem = ThemedSelectOption | ThemedSelectGroup

interface ThemedSelectProps {
  id?: string
  className?: string
  value: string
  options: ThemedSelectItem[]
  onChange: (value: string) => void
  disabled?: boolean
  ariaLabel?: string
  placeholder?: string
}

function isGroup(item: ThemedSelectItem): item is ThemedSelectGroup {
  return 'options' in item
}

export default function ThemedSelect({
  id,
  className,
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  placeholder = 'Select',
}: ThemedSelectProps) {
  const generatedId = useId()
  const selectId = id ?? generatedId
  const listboxId = `${selectId}-listbox`
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [menuRect, setMenuRect] = useState({ left: 0, top: 0, width: 0 })

  const flatOptions = useMemo(
    () => options.flatMap((item) => (isGroup(item) ? item.options : [item])),
    [options],
  )
  const selectedOption = flatOptions.find((option) => option.value === value)
  const enabledOptions = flatOptions.filter((option) => !option.disabled)
  const selectedEnabledIndex = Math.max(
    0,
    enabledOptions.findIndex((option) => option.value === value),
  )
  const [highlightedIndex, setHighlightedIndex] = useState(selectedEnabledIndex)

  useEffect(() => {
    if (!isOpen) return
    setHighlightedIndex(selectedEnabledIndex)
  }, [isOpen, selectedEnabledIndex])

  useEffect(() => {
    if (!isOpen) return

    function updatePosition() {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const availableBelow = window.innerHeight - rect.bottom - 8
      const estimatedMenuHeight = Math.min(320, 36 * Math.max(1, flatOptions.length) + 16)
      const top = availableBelow >= Math.min(estimatedMenuHeight, 220)
        ? rect.bottom + 6
        : Math.max(8, rect.top - estimatedMenuHeight - 6)
      setMenuRect({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
        top,
        width: rect.width,
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [flatOptions.length, isOpen])

  useEffect(() => {
    if (!isOpen) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setIsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isOpen])

  function choose(nextValue: string) {
    onChange(nextValue)
    setIsOpen(false)
    triggerRef.current?.focus()
  }

  function moveHighlight(step: 1 | -1) {
    if (enabledOptions.length === 0) return
    setHighlightedIndex((current) => (current + step + enabledOptions.length) % enabledOptions.length)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!isOpen) setIsOpen(true)
      else moveHighlight(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!isOpen) setIsOpen(true)
      else moveHighlight(-1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!isOpen) {
        setIsOpen(true)
        return
      }
      const highlighted = enabledOptions[highlightedIndex]
      if (highlighted) choose(highlighted.value)
    } else if (event.key === 'Escape') {
      setIsOpen(false)
    }
  }

  const menu = isOpen
    ? createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          className={styles.menu}
          role="listbox"
          aria-labelledby={selectId}
          style={{ left: menuRect.left, top: menuRect.top, width: menuRect.width }}
        >
          {options.map((item) => {
            if (isGroup(item)) {
              return (
                <div className={styles.group} key={item.label} role="group" aria-label={item.label}>
                  <div className={styles.groupLabel}>{item.label}</div>
                  {item.options.map((option) => renderOption(option))}
                </div>
              )
            }
            return renderOption(item)
          })}
        </div>,
        document.body,
      )
    : null

  function renderOption(option: ThemedSelectOption) {
    const enabledIndex = enabledOptions.findIndex((item) => item.value === option.value)
    return (
      <button
        key={option.value}
        className={styles.option}
        type="button"
        role="option"
        aria-selected={option.value === value}
        data-highlighted={enabledIndex === highlightedIndex ? 'true' : undefined}
        data-selected={option.value === value ? 'true' : undefined}
        disabled={option.disabled}
        onMouseEnter={() => {
          if (enabledIndex >= 0) setHighlightedIndex(enabledIndex)
        }}
        onClick={() => choose(option.value)}
      >
        {option.label}
      </button>
    )
  }

  return (
    <div ref={rootRef} className={[styles.root, className].filter(Boolean).join(' ')}>
      <button
        ref={triggerRef}
        id={selectId}
        className={styles.trigger}
        type="button"
        role="combobox"
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        data-open={isOpen ? 'true' : undefined}
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        onKeyDown={handleKeyDown}
      >
        <span className={styles.value}>{selectedOption ? selectedOption.label : placeholder}</span>
        <span className={styles.chevron} aria-hidden="true" />
      </button>
      {menu}
    </div>
  )
}
