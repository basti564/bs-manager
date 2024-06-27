import { useRef, MouseEvent, useEffect, useState } from "react";
import { useTranslation } from "renderer/hooks/use-translation.hook";
import "./bsm-timed-button.component.css";

type Props = {
    duration: number;
    textBeforeDuration: string;
    textAfterDuration: string;
    onComplete: () => void;
    onClick: React.ComponentProps<'button'>['onClick'];
};


export function BsmTimedButton({ duration, textBeforeDuration, textAfterDuration, onComplete, onClick }: Props) {
    const t = useTranslation();
    const ref = useRef(null);
    const [remainingTime, setRemainingTime] = useState(duration);

    useEffect(() => {
      const timer = setInterval(() => {
        setRemainingTime(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            onComplete();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }, [duration, onComplete]);

    const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
        setRemainingTime(0);
        onClick?.(e)
    };

    return (
        <div className="button-container">
            <button type="button" onClick={handleClick} className="timer-button" ref={ref}>
                     {t(textBeforeDuration) + remainingTime + t(textAfterDuration)}
                     <div className="progress-bar" style={{ animationDuration: `${duration}s` }} />
            </button>
        </div>
    );
}
