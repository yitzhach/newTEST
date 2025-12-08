import React, { useState } from 'react';

const Contact: React.FC = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    message: ''
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Since this is a static site without a backend, we use mailto.
    // In a real production environment, you might use a service like Formspree or EmailJS.
    const subject = `Portfolio Inquiry from ${formData.name}`;
    const body = `Name: ${formData.name}%0D%0AEmail: ${formData.email}%0D%0A%0D%0AMessage:%0D%0A${formData.message}`;
    window.location.href = `mailto:isaac@isaacandersonart.com?subject=${subject}&body=${body}`;
  };

  return (
    <section id="contact" className="py-20 px-4 bg-gray-50 border-t border-gray-100">
      <div className="max-w-xl mx-auto text-center">
        <h2 className="text-2xl font-light tracking-[0.1em] text-gray-900 mb-8 uppercase">
          Contact
        </h2>
        <p className="text-gray-500 mb-8 font-light">
          Interested in purchasing a piece or discussing a commission? Please fill out the form below.
        </p>
        
        <form onSubmit={handleSubmit} className="space-y-6 text-left">
          <div>
            <label htmlFor="name" className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Name</label>
            <input
              type="text"
              id="name"
              name="name"
              required
              value={formData.name}
              onChange={handleChange}
              className="w-full bg-white border border-gray-200 p-3 focus:outline-none focus:border-gray-400 transition-colors font-light"
              placeholder="Your Name"
            />
          </div>
          
          <div>
            <label htmlFor="email" className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Email</label>
            <input
              type="email"
              id="email"
              name="email"
              required
              value={formData.email}
              onChange={handleChange}
              className="w-full bg-white border border-gray-200 p-3 focus:outline-none focus:border-gray-400 transition-colors font-light"
              placeholder="Your Email"
            />
          </div>
          
          <div>
            <label htmlFor="message" className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Message</label>
            <textarea
              id="message"
              name="message"
              rows={5}
              required
              value={formData.message}
              onChange={handleChange}
              className="w-full bg-white border border-gray-200 p-3 focus:outline-none focus:border-gray-400 transition-colors font-light"
              placeholder="How can I help you?"
            ></textarea>
          </div>

          <div className="text-center mt-8">
            <button
              type="submit"
              className="px-8 py-3 bg-gray-900 text-white font-light tracking-widest text-sm hover:bg-gray-700 transition-colors uppercase"
            >
              Send Message
            </button>
          </div>
        </form>
      </div>
    </section>
  );
};

export default Contact;