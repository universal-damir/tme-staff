'use client';

import React, { useState, useRef } from 'react';
import { TME_COLORS } from '@/lib/constants';
import { Upload, CheckCircle, AlertCircle, X, Loader2 } from 'lucide-react';

interface UploadSlotProps {
  label: string;
  description: string;
  expectedType: 'COVER' | 'INSIDE_PAGES' | 'DATA_PAGE' | 'OBSERVATIONS_PAGE';
  file: File | null;
  onUpload: (file: File) => Promise<boolean>;
  onRemove: () => void;
  validated: boolean;
  validating: boolean;
  error?: string;
  preview?: string;
}

export function UploadSlot({
  label,
  description,
  expectedType: _expectedType, // Reserved for future use
  file: _file, // File ref tracked by parent
  onUpload,
  onRemove,
  validated,
  validating,
  error,
  preview,
}: UploadSlotProps) {
  void _expectedType;
  void _file;
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      await onUpload(selectedFile);
    }
    // Reset input
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type.startsWith('image/')) {
      await onUpload(droppedFile);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const getBorderColor = () => {
    if (error) return 'border-red-300';
    if (validated) return 'border-green-300';
    if (isDragging) return 'border-[#243F7B]';
    return 'border-gray-200';
  };

  const getBgColor = () => {
    if (error) return 'bg-red-50';
    if (validated) return 'bg-green-50';
    if (isDragging) return 'bg-blue-50';
    return 'bg-gray-50';
  };

  return (
    <div className="flex flex-col">
      <label
        className="block text-sm font-medium mb-2"
        style={{ color: TME_COLORS.primary }}
      >
        {label}
      </label>

      <div
        className={`relative flex-1 border-2 border-dashed rounded-lg transition-all duration-200 ${getBorderColor()} ${getBgColor()}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {/* File Input (hidden) */}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Preview or Upload Prompt */}
        {preview ? (
          <div className="relative p-2">
            {/* Image Preview - using img for base64 data URLs */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt={label}
              className="w-full h-32 object-cover rounded-lg"
            />

            {/* Status Badge */}
            <div className="absolute top-4 right-4">
              {validating ? (
                <div className="bg-blue-100 text-blue-600 px-2 py-1 rounded-full text-xs flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Validating...
                </div>
              ) : validated ? (
                <div className="bg-green-100 text-green-600 px-2 py-1 rounded-full text-xs flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" />
                  Valid
                </div>
              ) : error ? (
                <div className="bg-red-100 text-red-600 px-2 py-1 rounded-full text-xs flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Invalid
                </div>
              ) : null}
            </div>

            {/* Remove Button */}
            <button
              type="button"
              onClick={onRemove}
              className="absolute top-4 left-4 bg-white rounded-full p-1 shadow-md hover:bg-gray-100 transition-colors"
            >
              <X className="w-4 h-4 text-gray-600" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-full h-32 flex flex-col items-center justify-center gap-2 p-4 cursor-pointer hover:bg-gray-100 transition-colors rounded-lg"
          >
            <Upload className="w-8 h-8 text-gray-400" />
            <span className="text-xs text-gray-500 text-center">{description}</span>
          </button>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <p className="mt-2 text-xs text-red-500 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {error}
        </p>
      )}

      {/* Validated Message */}
      {validated && !error && (
        <p className="mt-2 text-xs text-green-600 flex items-center gap-1">
          <CheckCircle className="w-3 h-3" />
          Page verified
        </p>
      )}
    </div>
  );
}
