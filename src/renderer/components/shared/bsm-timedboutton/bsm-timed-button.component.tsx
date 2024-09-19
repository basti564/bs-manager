import React, { useEffect, MouseEvent, useState } from "react";
import { useTranslation } from "renderer/hooks/use-translation.hook";

type Props = {
    text: string;
    onClick: React.ComponentProps<'button'>['onClick'];
    onComplete: () => void;
};

export function BsmTimedButton({ onClick, onComplete, text }: Props) {
    const t = useTranslation();
    const [isVisible, setIsVisible] = useState(false);
    const [timeleft, setTimeleft] = useState(5);

    useEffect(() => {
        setIsVisible(true);

        const interval = setInterval(() => {
            setTimeleft((time) => {
                if (time <= 1) {
                    clearInterval(interval);
                    return 0;
                }
                return time - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (timeleft === 0) {
           // onComplete();
        }
    }, [timeleft, onComplete]);

    const handleOnClick = (e: MouseEvent<HTMLButtonElement>) => {
        onClick(e);
    };

    return (
        <div className="absolute w-full bottom-4 flex-col flex items-center">
            <span className="z-10 text-white font-bold">{`Download will start in ${timeleft} seconds`}</span>
            <div className="flex gap-2">
            <button
                onClick={handleOnClick}
                type="button"
                className="px-2 w-fit h-7 flex justify-center items-center rounded-md font-bold bg-light-main-color-2 dark:bg-blue-500 hover:brightness-125 overflow-hidden"
            >{t(text)}</button>
            </div>
            <span className=" text-white text-sm font-bold">3 Versions Selected </span>
        </div>
    );
}
