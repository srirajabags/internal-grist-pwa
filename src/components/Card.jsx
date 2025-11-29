import React from 'react';

const Card = ({ children, className = "", ...props }) => (
    <div className={`bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden ${className}`} {...props}>
        {children}
    </div>
);

export default Card;
