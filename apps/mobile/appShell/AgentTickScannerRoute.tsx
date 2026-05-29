import type { ComponentProps, Dispatch, SetStateAction } from "react";

import type { Screen } from "../AppLogic";
import { ScannerScreen } from "../scanner/ScannerScreen";

type AgentTickScannerRouteProps = {
  cameraPermission: ComponentProps<typeof ScannerScreen>["cameraPermission"];
  handlePairingScan: ComponentProps<typeof ScannerScreen>["onScan"];
  requestCameraPermission: () => unknown;
  scannerLocked: boolean;
  setScreen: Dispatch<SetStateAction<Screen>>;
};

export function AgentTickScannerRoute({
  cameraPermission,
  handlePairingScan,
  requestCameraPermission,
  scannerLocked,
  setScreen,
}: AgentTickScannerRouteProps) {
  return (
    <ScannerScreen
      cameraPermission={cameraPermission}
      scanning={scannerLocked}
      onCancel={() => setScreen("settings")}
      onRequestPermission={() => void requestCameraPermission()}
      onScan={(result) => void handlePairingScan(result)}
    />
  );
}
