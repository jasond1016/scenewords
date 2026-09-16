import { useEffect, useState } from "react";
import { fetchUploadedFileBinary } from "../api";

interface Props {
  fileId: string;
  token: string;
  alt: string;
  className?: string;
}

export function UploadedImage({ fileId, token, alt, className }: Props) {
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    fetchUploadedFileBinary(fileId, token)
      .then(({ blob }) => {
        if (!active) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => {
        if (active) {
          setSource(null);
        }
      });
    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [fileId, token]);

  if (!source) {
    return <div className={className} aria-label={alt} />;
  }
  return <img src={source} alt={alt} className={className} />;
}
