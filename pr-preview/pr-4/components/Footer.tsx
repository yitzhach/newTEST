import React from 'react';

const Footer: React.FC = () => {
  return (
    <footer className="py-12 bg-white border-t border-gray-100">
      <div className="container mx-auto px-4 flex flex-col items-center justify-center text-center space-y-4">
        <h3 className="text-sm font-semibold tracking-widest text-gray-900 uppercase">
          Isaac Anderson Art
        </h3>
        <p className="text-gray-500 text-sm font-light">
          &copy; {new Date().getFullYear()} Isaac Anderson Art. All rights reserved.
        </p>
      </div>
    </footer>
  );
};

export default Footer;