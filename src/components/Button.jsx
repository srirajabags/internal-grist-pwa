import React from 'react';

const Button = ({ onClick, children, variant = "primary", disabled = false, className = "", icon: Icon }) => {
    const baseStyle = "flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
    const variants = {
        primary: "bg-green-600 text-white hover:bg-green-700",
        secondary: "bg-slate-100 text-slate-700 hover:bg-slate-200",
        outline: "border border-slate-200 text-slate-600 hover:bg-slate-50",
        ghost: "text-slate-600 hover:bg-slate-100"
    };

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`${baseStyle} ${variants[variant]} ${className}`}
        >
            {Icon && <Icon size={18} />}
            {children}
        </button>
    );
};

export default Button;
