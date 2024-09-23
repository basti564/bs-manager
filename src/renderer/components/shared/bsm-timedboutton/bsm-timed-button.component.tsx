import React, { useEffect, MouseEvent, useState } from "react";
import { useTranslation } from "renderer/hooks/use-translation.hook";
import { useThemeColor } from "renderer/hooks/use-theme-color.hook";
import { getCorrectTextColor } from "renderer/helpers/correct-text-color";

type BsmButtonType = "primary" | "secondary" | "none";

type Props = {
    text: string;
    timeout: number;
    onClick: React.ComponentProps<'button'>['onClick'];
    onComplete: () => void;
    typeColor?: BsmButtonType;

};

export function BsmTimedButton({ onClick, onComplete, text, timeout, typeColor }: Props) {
    const t = useTranslation();
    const [isVisible, setIsVisible] = useState(false);
    const [timeleft, setTimeleft] = useState(5);
    const { firstColor, secondColor } = useThemeColor();

    const primaryColor = (() => {
        if (typeColor === "primary") {
            return firstColor;
        }
        if (typeColor === "secondary") {
            return secondColor;
        }
        return undefined;
    })();

    const textColor = (() => {
        if (primaryColor) {
            return getCorrectTextColor(primaryColor);
        }
        return typeColor && typeColor !== "none" ? "white" : undefined;
    })();

    const renderTypeColor = (() => {
        if (!typeColor) {
            return "bg-light-main-color-2 dark:bg-main-color-2"
        }
        return "";
    })();

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
        <div className="absolute w-full bottom-9 h-8 flex items-center justify-center">
            <button
                onClick={handleOnClick}
                type="button"
                className={`absolute px-2 w-max h-full flex justify-center items-center rounded-md font-bold ${renderTypeColor} overflow-hidden hover:brightness-125`}
                style={{ backgroundColor: primaryColor }}
            >
                <span className="z-10 text-white" style={{ ...(!!textColor && { color: `${textColor}` }) }}>{t(text)}</span>
                <div
                    className={`absolute w-full h-full bg-black opacity-80 transition-transform ease-linear transform ${
                        isVisible ? 'translate-x-full' : '-translate-x-0'
                    }`}
                    style={{ transitionDuration: `${timeout}ms` }}
                />
            </button>
        </div>
    );
}
