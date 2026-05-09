import type { ProgressInfo } from 'electron-updater'
import { useCallback, useEffect, useState } from 'react'
import Modal from '@/components/update/Modal'
import Progress from '@/components/update/Progress'
import './update.css'

const Update = () => {
  const bridge = window.voidcast
  const [checking, setChecking] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [versionInfo, setVersionInfo] = useState<VersionInfo>()
  const [updateError, setUpdateError] = useState<ErrorType>()
  const [progressInfo, setProgressInfo] = useState<Partial<ProgressInfo>>()
  const [modalOpen, setModalOpen] = useState<boolean>(false)
  const [modalBtn, setModalBtn] = useState<{
    cancelText?: string
    okText?: string
    onCancel?: () => void
    onOk?: () => void
  }>({
    onCancel: () => setModalOpen(false),
    onOk: () => { void bridge?.startUpdateDownload() },
  })

  const checkUpdate = async () => {
    if (!bridge) return
    setChecking(true)
    /**
     * @type {import('electron-updater').UpdateCheckResult | null | { message: string, error: Error }}
     */
    const result = await bridge.checkForUpdates()
    const maybe = result as { error?: ErrorType } | null
    setProgressInfo({ percent: 0 })
    setChecking(false)
    setModalOpen(true)
    if (maybe?.error) {
      setUpdateAvailable(false)
      setUpdateError(maybe.error)
    }
  }

  const onUpdateCanAvailable = useCallback((arg1: VersionInfo) => {
    setVersionInfo(arg1)
    setUpdateError(undefined)
    // Can be update
    if (arg1.update) {
      setModalBtn(state => ({
        ...state,
        cancelText: 'Cancel',
        okText: 'Update',
        onOk: () => { void bridge?.startUpdateDownload() },
      }))
      setUpdateAvailable(true)
    } else {
      setUpdateAvailable(false)
    }
  }, [bridge])

  const onUpdateError = useCallback((arg1: ErrorType) => {
    setUpdateAvailable(false)
    setUpdateError(arg1)
  }, [])

  const onDownloadProgress = useCallback((arg1: ProgressInfo) => {
    setProgressInfo(arg1)
  }, [])

  const onUpdateDownloaded = useCallback(() => {
    setProgressInfo({ percent: 100 })
    setModalBtn(state => ({
      ...state,
      cancelText: 'Later',
      okText: 'Install now',
      onOk: () => { void bridge?.quitAndInstallUpdate() },
    }))
  }, [bridge])

  useEffect(() => {
    if (!bridge) return
    // Get version information and whether to update
    const offAvailable = bridge.onUpdateCanAvailable((payload) => {
      onUpdateCanAvailable(payload as VersionInfo)
    })
    const offError = bridge.onUpdateError((payload) => {
      onUpdateError(payload as ErrorType)
    })
    const offProgress = bridge.onUpdateDownloadProgress((payload) => {
      onDownloadProgress(payload as ProgressInfo)
    })
    const offDownloaded = bridge.onUpdateDownloaded(onUpdateDownloaded)

    return () => {
      offAvailable()
      offError()
      offProgress()
      offDownloaded()
    }
  }, [bridge, onUpdateCanAvailable, onUpdateError, onDownloadProgress, onUpdateDownloaded])

  return (
    <>
      <Modal
        open={modalOpen}
        cancelText={modalBtn?.cancelText}
        okText={modalBtn?.okText}
        onCancel={modalBtn?.onCancel}
        onOk={modalBtn?.onOk}
        footer={updateAvailable ? /* hide footer */null : undefined}
      >
        <div className='modal-slot'>
          {updateError
            ? (
              <div>
                <p>Error downloading the latest version.</p>
                <p>{updateError.message}</p>
              </div>
            ) : updateAvailable
              ? (
                <div>
                  <div>The last version is: v{versionInfo?.newVersion}</div>
                  <div className='new-version__target'>v{versionInfo?.version} -&gt; v{versionInfo?.newVersion}</div>
                  <div className='update__progress'>
                    <div className='progress__title'>Update progress:</div>
                    <div className='progress__bar'>
                      <Progress percent={progressInfo?.percent} ></Progress>
                    </div>
                  </div>
                </div>
              )
              : (
                <div className='can-not-available'>{JSON.stringify(versionInfo ?? {}, null, 2)}</div>
              )}
        </div>
      </Modal>
      <button disabled={checking} onClick={checkUpdate}>
        {checking ? 'Checking...' : 'Check update'}
      </button>
    </>
  )
}

export default Update
