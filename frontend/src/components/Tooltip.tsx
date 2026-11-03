import React, { useState } from 'react';
import { Info } from 'lucide-react';
import { clsx } from 'clsx';

interface TooltipProps {
  content: React.ReactNode;
  children?: React.ReactNode;
  placement?: 'top' | 'bottom' | 'right' | 'left';
  maxWidth?: number;
  iconSize?: number;
}

/**
 * Inline tooltip — hover/focus to reveal. If no children are passed,
 * renders an info icon as the trigger.
 */
export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  placement = 'top',
  maxWidth = 280,
  iconSize = 14,
}) => {
  const [open, setOpen] = useState(false);

  const trigger = children ?? (
    <Info className="text-navy-400 hover:text-heading transition-colors" style={{ width: iconSize, height: iconSize }} />
  );

  const placementClasses: Record<string, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
    >
      {trigger}
      {open && (
        <span
          role="tooltip"
          className={clsx(
            'absolute z-50 px-3 py-2 rounded-md bg-navy-900 text-heading text-xs leading-relaxed',
            'border border-navy-500 shadow-card-hover pointer-events-none',
            'whitespace-normal',
            placementClasses[placement]
          )}
          style={{ maxWidth, width: 'max-content' }}
        >
          {content}
        </span>
      )}
    </span>
  );
};
