import { useRef, MouseEvent, useEffect, useState } from "react";
import { useTranslation } from "renderer/hooks/use-translation.hook";
import "./bsm-timed-button.component.css";
import { black, white } from "tailwindcss/colors";

type Props = {
    duration: number;
    text: string;
    onComplete: () => void;
    onClick: React.ComponentProps<'button'>['onClick'];
};


export function BsmTimedButton({ duration, text, onComplete, onClick }: Props) {
    const t = useTranslation();
    const ref = useRef(null);

    const [timeout, setTimeout] = useState(duration);

    const timer = setInterval(() => {
        if(timeout === 0) {
            clearInterval(timer);
            return;
        }
        setTimeout(timeout - 1);
    }
    , 1000);


    const handleOnClick = (e: MouseEvent<HTMLButtonElement>) => {
        onClick(e);
        setTimeout(duration);
    }

    handleOnComplete = () => {
        onComplete();
    }

    return (
        <button ref={ref} onClick={handleOnClick} type="button" className="w-full bg-gray-200 rounded-full dark:bg-gray-700" >
            <div className="transition-all duration-1000 ease-in-out w-full h-full bg-blue-500 rounded-full dark:bg-blue-700">
                {`${text}`}
            </div>
        </button>
    )
}
