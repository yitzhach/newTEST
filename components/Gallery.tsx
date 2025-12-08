import React, { useState, useEffect, useCallback } from 'react';
import { GALLERY_IMAGES } from '../constants';
import { ArtImage } from '../types';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

const Gallery: React.FC = () => {
  const [selectedImage, setSelectedImage] = useState<ArtImage | null>(null);
  
  // Touch state for swipe detection
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  const openLightbox = (image: ArtImage) => {
    setSelectedImage(image);
    document.body.style.overflow = 'hidden';
  };

  const closeLightbox = useCallback(() => {
    setSelectedImage(null);
    document.body.style.overflow = 'auto';
  }, []);

  const navigateImage = useCallback((direction: 'next' | 'prev', e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    setSelectedImage((currentImage) => {
      if (!currentImage) return null;
      
      const currentIndex = GALLERY_IMAGES.findIndex(img => img.id === currentImage.id);
      let newIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;

      // Loop around
      if (newIndex >= GALLERY_IMAGES.length) newIndex = 0;
      if (newIndex < 0) newIndex = GALLERY_IMAGES.length - 1;

      return GALLERY_IMAGES[newIndex];
    });
  }, []);

  // Keyboard navigation handler
  useEffect(() => {
    if (!selectedImage) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        navigateImage('next');
      } else if (e.key === 'ArrowLeft') {
        navigateImage('prev');
      } else if (e.key === 'Escape') {
        closeLightbox();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedImage, navigateImage, closeLightbox]);

  // Swipe Handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null); // Reset previous touch end to prevent stale swipe detection
    setTouchStart(e.targetTouches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const handleTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    
    const distance = touchStart - touchEnd;
    const minSwipeDistance = 50;
    
    if (distance > minSwipeDistance) {
      // Swiped Left -> Next
      navigateImage('next');
    } else if (distance < -minSwipeDistance) {
      // Swiped Right -> Prev
      navigateImage('prev');
    }
    
    // Reset
    setTouchStart(null);
    setTouchEnd(null);
  };

  return (
    <section id="gallery" className="py-20 px-4 md:px-8 bg-white max-w-7xl mx-auto">
      {/* Grid Layout: 1 col mobile, 2 col tablet, 3 col desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 md:gap-8">
        {GALLERY_IMAGES.map((image) => (
          <div
            key={image.id}
            className="group cursor-pointer overflow-hidden aspect-square relative bg-gray-100"
            onClick={() => openLightbox(image)}
          >
            <img
              src={image.src}
              alt={image.alt}
              className="w-full h-full object-cover transition-transform duration-500 ease-in-out group-hover:scale-105"
              loading="lazy"
            />
            {/* Hover overlay */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center">
              <span className="text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300 font-light tracking-widest text-sm border border-white px-4 py-2">
                VIEW
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Lightbox Overlay */}
      {selectedImage && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-sm p-4"
          onClick={closeLightbox}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <button
            onClick={closeLightbox}
            className="absolute top-6 right-6 text-white/70 hover:text-white transition-colors p-2 z-50"
            aria-label="Close lightbox"
          >
            <X size={32} />
          </button>

          <button
            onClick={(e) => navigateImage('prev', e)}
            className="absolute left-4 md:left-8 text-white/50 hover:text-white transition-colors p-2 hidden md:block z-50"
            aria-label="Previous image"
          >
            <ChevronLeft size={48} />
          </button>
          
          <div className="relative max-w-full max-h-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
             {/* Key helps trigger animation reset on image change */}
             <img
              key={selectedImage.id}
              src={selectedImage.src}
              alt={selectedImage.alt}
              className="max-w-full max-h-[85vh] object-contain shadow-2xl animate-fadeIn select-none"
              draggable={false}
            />
            <p className="absolute -bottom-8 left-0 right-0 text-center text-gray-400 font-light tracking-wide text-sm animate-fadeIn">
              {selectedImage.title}
            </p>
          </div>

          <button
            onClick={(e) => navigateImage('next', e)}
            className="absolute right-4 md:right-8 text-white/50 hover:text-white transition-colors p-2 hidden md:block z-50"
            aria-label="Next image"
          >
            <ChevronRight size={48} />
          </button>
        </div>
      )}
    </section>
  );
};

export default Gallery;