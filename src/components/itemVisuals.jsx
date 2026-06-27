import React from 'react';
import { colourToCss, shade, itemForm } from '../utils/itemForms';

// Visual components for representing factory item forms (roll, sheet, bags,
// gussets, handle) tinted with the item colour. Pure helpers/constants live in
// ../utils/itemForms so this file only exports components (fast-refresh safe).

const HEIGHT_CLASS = { sm: 'h-10', md: 'h-16', lg: 'h-20' };

// SVG illustration for a form, tinted with the item colour.
export const ItemVisual = ({ colour, type, name, size = 'md' }) => {
    const base = colourToCss(colour);
    const fill = base;
    const stroke = shade(base, -0.45);
    const accent = shade(base, -0.16);
    const lighter = shade(base, 0.28);
    const form = itemForm(type, name);
    const sw = 2;

    let shape;
    switch (form) {
        case 'sheet':
            shape = (
                <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
                    {[0, 1, 2, 3].map((i) => {
                        const y = 20 + i * 8;
                        return <path key={i} d={`M22 ${y} L60 ${y - 8} L84 ${y} L46 ${y + 8} Z`} fill={i % 2 ? lighter : fill} />;
                    })}
                </g>
            );
            break;
        case 'dcut':
            shape = (
                <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
                    <rect x="32" y="10" width="36" height="46" rx="2" fill={fill} />
                    <rect x="43" y="15" width="14" height="6" rx="3" fill={lighter} />
                    <line x1="32" y1="26" x2="68" y2="26" strokeWidth="1.5" strokeDasharray="3 2" />
                </g>
            );
            break;
        case 'wcut':
            shape = (
                <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round" fill={fill}>
                    <path d="M28 24 L28 58 L72 58 L72 24" />
                    <path d="M28 24 L28 12 L41 12 L41 22" fill={lighter} />
                    <path d="M72 24 L72 12 L59 12 L59 22" fill={lighter} />
                    <path d="M41 22 Q50 31 59 22" fill="none" />
                </g>
            );
            break;
        case 'sidepatty':
            shape = (
                <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
                    <path d="M30 14 L42 20 L42 56 L30 50 Z" fill={fill} />
                    <path d="M42 20 L54 14 L54 50 L42 56 Z" fill={accent} />
                    <path d="M54 14 L66 20 L66 56 L54 50 Z" fill={fill} />
                    <path d="M66 20 L78 14 L78 50 L66 56 Z" fill={accent} />
                </g>
            );
            break;
        case 'bottompatty':
            shape = (
                <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
                    <path d="M24 30 L52 18 L84 30 L56 42 Z" fill={lighter} />
                    <path d="M24 30 L24 48 L56 60 L56 42 Z" fill={fill} />
                    <path d="M56 42 L56 60 L84 48 L84 30 Z" fill={accent} />
                </g>
            );
            break;
        case 'handlebag':
            shape = (
                <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
                    <path d="M30 22 L30 58 L70 58 L70 22" fill={fill} />
                    <path d="M35 24 L35 13 L46 13 L46 24" fill={lighter} />
                    <path d="M65 24 L65 13 L54 13 L54 24" fill={lighter} />
                    <path d="M46 24 Q50 29 54 24" fill="none" />
                    <line x1="30" y1="36" x2="70" y2="36" strokeWidth="1.5" strokeDasharray="3 2" />
                </g>
            );
            break;
        case 'handle':
            shape = (
                <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
                    <rect x="14" y="27" width="72" height="11" rx="3" fill={fill} />
                    <rect x="17" y="29.5" width="12" height="6" fill="none" strokeWidth="1.3" />
                    <rect x="71" y="29.5" width="12" height="6" fill="none" strokeWidth="1.3" />
                    <line x1="17" y1="29.5" x2="29" y2="35.5" strokeWidth="1" />
                    <line x1="29" y1="29.5" x2="17" y2="35.5" strokeWidth="1" />
                    <line x1="71" y1="29.5" x2="83" y2="35.5" strokeWidth="1" />
                    <line x1="83" y1="29.5" x2="71" y2="35.5" strokeWidth="1" />
                </g>
            );
            break;
        case 'roll':
        default:
            shape = (
                <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
                    <path d="M18 42 L58 42 L68 56 L28 56 Z" fill={fill} />
                    <rect x="16" y="14" width="46" height="34" rx="3" fill={fill} />
                    <ellipse cx="16" cy="31" rx="7" ry="17" fill={fill} />
                    <ellipse cx="62" cy="31" rx="7" ry="17" fill={accent} />
                    <line x1="62" y1="31" x2="88" y2="31" strokeWidth="3" />
                    <ellipse cx="62" cy="31" rx="3" ry="6.5" fill={lighter} strokeWidth="1.4" />
                    <ellipse cx="88" cy="31" rx="2.5" ry="5.5" fill={accent} strokeWidth="1.4" />
                </g>
            );
            break;
    }

    return (
        <div className="flex items-center justify-center" style={{ filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.10))' }}>
            <svg viewBox="0 0 100 64" className={`w-full ${HEIGHT_CLASS[size] || HEIGHT_CLASS.md}`} preserveAspectRatio="xMidYMid meet">
                {shape}
            </svg>
        </div>
    );
};

export const Dim = ({ children }) => (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold text-teal-700 bg-teal-50 ring-1 ring-teal-200">
        {children}
    </span>
);
