import { BsmButton } from "renderer/components/shared/bsm-button.component"
import { ModalComponent,ModalExitCode } from "../../../services/modale.service";

export const OneClickChooseVersions: ModalComponent<void, void> = ({resolver}) => {
    return (
        <form onSubmit={e => {
            e.preventDefault();
            resolver({ exitCode: ModalExitCode.COMPLETED });
        }}>
            <h1>test</h1>
            <div className="grid grid-flow-col grid-cols-2 gap-4">
            <BsmButton typeColor="primary" className="rounded-md text-center transition-all" type="submit" withBar={false} text="modals.bs-uninstall.buttons.submit" />
            </div>
        </form>
    );
}
