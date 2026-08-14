import React from 'react';
import { colourToCss, shade, itemForm } from '../utils/itemForms';

// Visual components for representing factory item forms (roll, sheet, bags,
// gussets, handle) tinted with the item colour. Pure helpers/constants live in
// ../utils/itemForms so this file only exports components (fast-refresh safe).

const HEIGHT_CLASS = { sm: 'h-10', md: 'h-16', lg: 'h-20' };

// SVG illustration for a form, tinted with the item colour.
export const ItemVisual = ({ colour, type, name, size = 'md' }) => {
    const form = itemForm(type, name);
    // Model-number sheets carry the model code in the colour field — a customer
    // picks either a colour or a model, never both — and the stock itself is
    // always white. Tint from that, or colourToCss would hash "F8" into an
    // arbitrary hue and imply a colour the sheet does not have.
    const base = colourToCss(form === 'modelsheet' ? 'WHITE' : colour);
    const fill = base;
    const stroke = shade(base, -0.45);
    const accent = shade(base, -0.16);
    const lighter = shade(base, 0.28);
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
        case 'bottompattysheet':
            // The sheet bottom patties are cut from: a stacked pair of flat sheets
            // with the cut lines that divide the top one into patty strips.
            shape = (
                <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
                    <rect x="28" y="8" width="56" height="38" rx="2" fill={lighter} />
                    <rect x="16" y="18" width="56" height="38" rx="2" fill={fill} />
                    {[27, 37, 47].map((y) => (
                        <line key={y} x1="16" y1={y} x2="72" y2={y} strokeWidth="1" strokeDasharray="2 2.5" />
                    ))}
                </g>
            );
            break;
        case 'modelsheet':
            // Same stacked sheets, marked with the printed model-number block that
            // is what distinguishes one model sheet from another.
            shape = (
                <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
                    <rect x="28" y="8" width="56" height="38" rx="2" fill={lighter} />
                    <rect x="16" y="18" width="56" height="38" rx="2" fill={fill} />
                    <rect x="30" y="28" width="28" height="18" rx="2" fill={lighter} strokeWidth="1.4" />
                    <line x1="35" y1="34" x2="53" y2="34" strokeWidth="1.4" strokeLinecap="round" />
                    <line x1="35" y1="40" x2="46" y2="40" strokeWidth="1.4" strokeLinecap="round" />
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
        case 'ucut':
            // U-cut bag: the handle is a U-shaped notch cut out of the top edge,
            // leaving a strap on either side (vs the D-cut's punched hole).
            shape = (
                <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
                    <path d="M32 10 L41 10 L41 17 Q50 26 59 17 L59 10 L68 10 L68 56 L32 56 Z" fill={fill} />
                    <line x1="32" y1="30" x2="68" y2="30" strokeWidth="1.5" strokeDasharray="3 2" />
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
            // Side-gusset strip: a single flat, tall, narrow cut piece with stitch
            // lines along the long edges where it is sewn to the bag body.
            shape = (
                <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
                    <rect x="40" y="8" width="20" height="48" rx="1.5" fill={fill} />
                    <line x1="44" y1="10.5" x2="44" y2="53.5" strokeWidth="1" strokeDasharray="2 2.5" />
                    <line x1="56" y1="10.5" x2="56" y2="53.5" strokeWidth="1" strokeDasharray="2 2.5" />
                </g>
            );
            break;
        case 'bottompatty':
            // Bottom-gusset strip: a single flat, wider, shorter cut piece with
            // stitch lines along the long edges where it is sewn on.
            shape = (
                <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
                    <rect x="16" y="24" width="68" height="16" rx="1.5" fill={fill} />
                    <line x1="18.5" y1="28" x2="81.5" y2="28" strokeWidth="1" strokeDasharray="2 2.5" />
                    <line x1="18.5" y1="36" x2="81.5" y2="36" strokeWidth="1" strokeDasharray="2 2.5" />
                </g>
            );
            break;
        case 'handlebag':
            // Handle bag as stored in the godown: the loop handle is fitted later,
            // so the body is drawn plain (rectangular, reinforced top hem) and the
            // handle appears only as a dashed "ghost" outline of where it will go.
            shape = (
                <g stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
                    <path d="M42 17 C 39 2 61 2 58 17" fill="none"
                        strokeWidth="1.4" strokeDasharray="3 2.5" strokeLinecap="round" />
                    <rect x="30" y="16" width="40" height="42" rx="2" fill={fill} />
                    <rect x="30" y="16" width="40" height="7" rx="2" fill={lighter} />
                </g>
            );
            break;
        case 'pressinghandle':
        case 'manualhandle':
        case 'readymadehandle':
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
