import { useEffect, useState } from "react";
import { BsmProgressBar } from "renderer/components/progress-bar/bsm-progress-bar.component";
import { BsmImage } from "renderer/components/shared/bsm-image.component";
import TitleBar from "renderer/components/title-bar/title-bar.component";
import { useTranslation } from "renderer/hooks/use-translation.hook";
import { MapsDownloaderService } from "renderer/services/maps-downloader.service";
import { NotificationService } from "renderer/services/notification.service";
import { ProgressBarService } from "renderer/services/progress-bar.service";
import { BeatSaverService } from "renderer/services/thrird-partys/beat-saver.service";
import { BsvMapDetail } from "shared/models/maps";
import defaultImage from "../../../../assets/images/default-version-img.jpg";
import { useService } from "renderer/hooks/use-service.hook";
import { useWindowArgs } from "renderer/hooks/use-window-args.hook";
import { useWindowControls } from "renderer/hooks/use-window-controls.hook";

import {BsmTimedButton} from "renderer/components/shared/bsm-timedboutton/bsm-timed-button.component";

export default function OneClickDownloadMap() {

    const bsv = useService(BeatSaverService);
    const mapsDownloader = useService(MapsDownloaderService);
    const progressBar = useService(ProgressBarService);
    const notification = useService(NotificationService);

    const { close: closeWindow } = useWindowControls();
    const { mapId, isHash } = useWindowArgs("mapId", "isHash");
    const [mapInfo, setMapInfo] = useState<BsvMapDetail>(null);
    const [downloadLaunched, setDownloadLaunched] = useState<boolean>(false);

    const t = useTranslation();

    const cover = mapInfo ? mapInfo.versions.at(0).coverURL : null;
    const title = mapInfo ? mapInfo.name : null;

    useEffect(() => {

        (async () => {
            const mapDetails = isHash === "true" ? (await bsv.getMapDetailsFromHashs([mapId])).at(0) : await bsv.getMapDetailsById(mapId);
            return mapDetails;
        })()
        .then(setMapInfo)

    }, []);

    const handleOnComplete = () => {
        setDownloadLaunched(true);
        progressBar.open();

        (async () => {
            const res = await mapsDownloader.oneClickInstallMap(mapInfo).then(() => true).catch(() => false);

            progressBar.complete();

            if (!res) {
                throw new Error("Failed to download map with OneClick");
            }

        })()
        .catch(() => {
            notification.notifySystem({ title: t("notifications.types.error"), body: t("notifications.maps.one-click-install.error") });
        })
        .then(() => {
            notification.notifySystem({ title: "OneClick", body: t("notifications.maps.one-click-install.success") });
        })
        .finally(() => {
            closeWindow();
        });

    }

    const handleOnClick = () => {
        // open modal to choose versions when the modal is closed, call handleOnComplete
    }

    return (
        <div className="relative w-screen h-screen overflow-hidden">
            {cover && <BsmImage className="absolute top-0 left-0 w-full h-full object-cover" image={cover} />}
            <div className="w-full h-full backdrop-brightness-50 backdrop-blur-md flex flex-col justify-start items-center gap-10">
                <TitleBar template="oneclick-download-map.html" />
                <BsmImage className="aspect-square w-1/2 object-cover rounded-md shadow-black shadow-lg" placeholder={defaultImage} image={cover} errorImage={defaultImage} />
                <h1 className="overflow-hidden font-bold italic text-xl text-gray-200 tracking-wide w-full text-center whitespace-nowrap text-ellipsis px-2">{title}</h1>
            </div>
            {!downloadLaunched ? (
                <div>
                    <BsmTimedButton onClick={handleOnClick} onComplete={handleOnComplete} text="oneclick.chooseInstall" typeColor="primary" timeout={50000} />
                    <span className="absolute bottom-5 left-0 w-full text-center text-gray-200 text-xs">{t("3 versions selected")}</span>
                </div>
            ) : (
                <BsmProgressBar />
            )}
        </div>
    );
}
