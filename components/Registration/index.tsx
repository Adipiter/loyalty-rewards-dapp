import Box from '@mui/material/Box';
import React, { FunctionComponent, useEffect, useMemo, useState } from 'react';
import { useActiveWeb3React } from 'snet-ui/Blockchain/web3Hooks';
import axios from 'utils/Axios';
import { setCardanoWalletAddress, setShowConnectionModal } from 'utils/store/features/walletSlice';
import { useAppDispatch, useAppSelector } from 'utils/store/hooks';
import Airdropinfo from 'snet-ui/Airdropinfo';
import Grid from '@mui/material/Grid';
import AirdropRegistrationMini from 'snet-ui/AirdropRegistrationMini';
import AirdropRegistration from 'snet-ui/AirdropRegistration';
import { AirdropStatusMessage, ClaimStatus, UserEligibility } from 'utils/constants/CustomTypes';
import { API_PATHS } from 'utils/constants/ApiPaths';
import {
  WindowStatus,
  windowStatusActionMap,
  windowStatusLabelMap,
  AIRDROP_WINDOW_STRING,
  AIRDROP_PENDING_CLAIM_STRING,
  AIRDROP_LINKS,
  AIRDROP_TOKEN_DIVISOR,
  TRANSACTION_TYPE,
  AIRDROP_CLAIM_IN_PROGRESS_STRING,
} from 'utils/airdropWindows';
import { useEthSign } from 'snet-ui/Blockchain/signatureHooks';
import { parseEthersError } from 'utils/ethereum';
import { useAirdropContract } from 'utils/AirdropContract';
import { TransactionResponse } from '@ethersproject/abstract-provider';
import AirdropRegistrationLoader from 'snet-ui/AirdropRegistration/SkeletonLoader';
import { APIError } from 'utils/errors';
import { AlertTypes } from 'utils/constants/alert';
import { AlertColor, Container } from '@mui/material';
import { selectActiveWindow } from 'utils/store/features/activeWindowSlice';
import moment from 'moment';
import { setAirdropStatus } from 'utils/store/features/airdropStatusSlice';
import useStyles from './styles';
import useInjectableWalletHook from 'libraries/useInjectableWalletHook';
import { supportedCardanoWallets } from 'utils/constants/cardanoWallet';
import BigNumber from 'bignumber.js';
import RegistrationSuccessModal from './registrationSuccessModal';
import ClaimSuccessModal from './claimSuccessModal';

const blockChainActionTypes = {
  CLAIM: 'claim',
  STAKE_AND_CLAIM: 'stake_and_claim',
};

interface RegistrationProps {
  userEligibility: UserEligibility;
  userRegistered: boolean;
  setUserRegistered: (value: boolean) => void;
  onViewSchedule: () => void;
  onViewRules: () => void;
  onViewNotification: () => void;
  claimStatus: ClaimStatus;
  setClaimStatus: (value: ClaimStatus) => void;
  airdropTotalTokens: { value: number; name: string };
  airdropWindowrewards: number;
  getUserEligibility: () => void;
  registrationID: string;
}

const Registration: FunctionComponent<RegistrationProps> = ({
  userEligibility,
  userRegistered,
  setUserRegistered,
  onViewSchedule,
  onViewRules,
  onViewNotification,
  claimStatus,
  setClaimStatus,
  airdropTotalTokens,
  airdropWindowrewards,
  getUserEligibility,
  registrationID,
}) => {
  const [stakeDetails, setStakeDetails] = useState<any>({ is_stakable: false });
  const [uiAlert, setUiAlert] = useState<{ type: AlertColor; message: any }>({ type: AlertTypes.info, message: '' });
  const [registrationId, setRegistrationId] = useState(registrationID);
  const [showRegistrationSuccess, setShowRegistrationSuccess] = useState<boolean>(false);
  const [showClaimSuccess, setShowClaimSuccess] = useState<boolean>(false);
  const [claimInitiated, setClaimInitiated] = useState<boolean>();
  const [airdropHistory, setAirdropHistory] = useState([]);
  const [claimedWindow, setClaimedWindow] = useState(0);
  const { account, library, chainId } = useActiveWeb3React();
  const ethSign = useEthSign();
  const airdropContract = useAirdropContract();

  const { window: activeWindow, totalWindows } = useAppSelector(selectActiveWindow);
  const { cardanoWalletAddress } = useAppSelector((state) => state.wallet);
  const { transferTokens } = useInjectableWalletHook([supportedCardanoWallets.NAMI]);

  const dispatch = useAppDispatch();
  const classes = useStyles();

  useEffect(() => {
    setClaimInitiated(claimStatus === ClaimStatus.NOT_STARTED ? false : true);
  }, [claimStatus]);

  useEffect(() => {
    setRegistrationId(registrationID);
  }, [registrationID]);
  useEffect(() => {
    if (!cardanoWalletAddress) {
      if (userEligibility === UserEligibility.NOT_ELIGIBLE) {
        setUiAlert({
          type: AlertTypes.error,
          message:
            'Your connected wallet is not eligible to map to a cardano wallet.  Please connect a compatible ETH wallet with avlialble AGIX funds.',
        });
      }
      if (userEligibility === UserEligibility.ELIGIBLE) {
        setUiAlert({
          type: AlertTypes.success,
          message: 'Your connected ETH wallet is eligible to map to your Cardano wallet.',
        });
      }
    }
  }, [userEligibility]);

  useEffect(() => {
    getClaimHistory();
    // Clear any previous state
    setUiAlert({ type: AlertTypes.info, message: '' });
  }, [activeWindow?.airdrop_id, activeWindow?.airdrop_window_id, account]);

  const endDate = useMemo(
    () =>
      activeWindow?.airdrop_window_status === WindowStatus.UPCOMING
        ? moment.utc(`${activeWindow?.airdrop_window_registration_start_period}`)
        : activeWindow?.airdrop_window_status === WindowStatus.REGISTRATION
        ? moment.utc(`${activeWindow?.airdrop_window_registration_end_period}`)
        : activeWindow?.airdrop_window_status === WindowStatus.IDLE
        ? moment.utc(`${activeWindow?.airdrop_window_claim_start_period}`)
        : activeWindow?.airdrop_window_status === WindowStatus.CLAIM ||
          activeWindow?.airdrop_window_status === WindowStatus.LAST_CLAIM
        ? moment.utc(`${activeWindow?.next_window_start_period}`)
        : moment.utc(),
    [activeWindow]
  );

  const getStakeDetails = async () => {
    try {
      if (!activeWindow || !account) return;
      const response: any = await axios.post(API_PATHS.STAKE_DETAILS, {
        address: account,
        airdrop_id: `${activeWindow.airdrop_id}`,
        airdrop_window_id: `${activeWindow.airdrop_window_id}`,
      });
      const stakeInfo = response.data.data.stake_details;
      setStakeDetails(stakeInfo);
    } catch (error) {}
  };

  const handleRegistration = async (cardanoAddress) => {
    try {
      if (!account) {
        dispatch(setShowConnectionModal(true));
        return;
      }

      const [walletAddress] = (await library?.listAccounts()) as string[];

      console.log('airdrop_id', activeWindow?.airdrop_id);
      console.log('airdrop_window_id', activeWindow?.airdrop_window_id);
      console.log('account', walletAddress);

      const { signature, blockNumber } = await ethSign.sign(
        ['uint256', 'uint256', 'uint256', 'address', 'string'],
        [Number(activeWindow?.airdrop_id), Number(activeWindow?.airdrop_window_id), cardanoAddress]
      );

      console.log('signature', signature);

      if (signature) {
        await airdropUserRegistration(account, blockNumber, signature, cardanoAddress);
        await getUserEligibility();
        setUiAlert({
          type: AlertTypes.success,
          message: '',
        });
        dispatch(setAirdropStatus(AirdropStatusMessage.CLAIM));
        dispatch(setCardanoWalletAddress(cardanoAddress));
        setUserRegistered(true);
        toggleRegistrationSuccessModal();
      } else {
        dispatch(setAirdropStatus(AirdropStatusMessage.WALLET_ACCOUNT_ERROR));
        setUiAlert({
          type: AlertTypes.error,
          message: 'Registration Failed: Unable to generate signature',
        });
      }
      // router.push(`airdrop/${airdrop.airdrop_window_id}`);
    } catch (error: any) {
      dispatch(setAirdropStatus(AirdropStatusMessage.WALLET_ACCOUNT_ERROR));
      setUiAlert({
        type: AlertTypes.error,
        message: `Registration Failed: ${error.message}`,
      });
    }
  };

  const convertAsReadableAmount = (balanceInCogs, decimals) => {
    const rawbalance = new BigNumber(balanceInCogs).dividedBy(new BigNumber(10 ** decimals)).toFixed();
    return rawbalance;
  };

  const getClaimHistory = async () => {
    if (!activeWindow || !account) return;
    const response: any = await axios.post(API_PATHS.AIRDROP_HISTORY, {
      address: account,
      airdrop_id: `${activeWindow.airdrop_id}`,
    });

    const isClaimInitiated = response.data.data.claim_history.some(
      (obj) => obj.airdrop_window_id === activeWindow.airdrop_window_id
    );

    const tempHistory: any = [];
    response.data.data.claim_history.forEach((item) => {
      const matchIndex = tempHistory.length
        ? tempHistory.findIndex((obj) => obj.airdrop_window_id === item.airdrop_window_id)
        : -1;
      if (matchIndex !== -1 && item.action_type === TRANSACTION_TYPE.TOKEN_TRANSFER) {
        tempHistory[matchIndex] = item;
      }
      if (matchIndex === -1) {
        tempHistory.push(item);
      }
    }, []);

    const claimedWindow =
      tempHistory.reduce((prev, current) => {
        if (current.txn_status === ClaimStatus.SUCCESS) {
          return prev.airdrop_window_id > current.airdrop_window_id ? prev : current;
        }
        return {};
      }, {}).airdrop_window_order || 0;

    const claimInProgress = tempHistory.some(
      (obj) => obj.airdrop_window_id === activeWindow.airdrop_window_id && obj.txn_status !== ClaimStatus.SUCCESS
    );
    if (claimInProgress) {
      setUiAlert({ type: AlertTypes.info, message: AIRDROP_CLAIM_IN_PROGRESS_STRING });
    }

    const history = tempHistory.map((el) => {
      const reward =
        el.action_type === TRANSACTION_TYPE.TOKEN_TRANSFER
          ? `${convertAsReadableAmount(el.claimable_amount, 8)} AGIX`
          : `${el.claimable_amount} ADA`;

      return {
        window: `Window ${el.airdrop_window_order} Rewards`,
        reward,
        status: `${el.txn_status === ClaimStatus.FAIL ? ClaimStatus.PENDING : el.txn_status}`,
        txn_hash: el.txn_hash,
        action_type: el.action_type,
      };
    });
    await getStakeDetails();
    if (isClaimInitiated && activeWindow.airdrop_window_order !== totalWindows) {
      dispatch(setAirdropStatus(`${AirdropStatusMessage.CLAIM_OPEN_SOON}`));
    }
    setClaimedWindow(claimedWindow);
    setClaimInitiated(isClaimInitiated);
    setAirdropHistory(history);
  };

  const handleAutoStake = async () => {
    if (
      typeof activeWindow?.airdrop_id === 'undefined' ||
      typeof activeWindow.airdrop_window_id === 'undefined' ||
      !account ||
      !library
    ) {
      return;
    }

    if (claimStatus === ClaimStatus.PENDING) {
      setUiAlert({
        type: AlertTypes.error,
        message: { AIRDROP_PENDING_CLAIM_STRING },
      });
      return;
    } else if (claimStatus === ClaimStatus.SUCCESS) {
      setUiAlert({
        type: AlertTypes.error,
        message: 'You have already Claimed',
      });
      return;
    }

    const getStakeDetails = async () => {
      try {
        const response: any = await axios.post(API_PATHS.CLAIM_SIGNATURE, {
          address: account,
          airdrop_id: activeWindow.airdrop_id.toString(),
          airdrop_window_id: activeWindow.airdrop_window_id.toString(),
        });

        return response.data.data;
      } catch (error: any) {
        const backendErrorMessage = error?.errorText?.error?.message;
        if (backendErrorMessage) {
          throw new APIError(backendErrorMessage);
        }
        throw error;
      }
    };

    const executeStakeMethod = async (
      signature: string,
      totalEligibleAmount: string,
      claimAmount: string,
      stakingAddress: string,
      tokenAddress: string,
      userWalletAddress: string,
      contractAddress: string
    ): Promise<TransactionResponse> => {
      const txn = await airdropContract.stake(
        contractAddress,
        tokenAddress,
        stakingAddress,
        stakeDetails.total_eligible_amount,
        stakeDetails.airdrop_rewards,
        stakeDetails.stakable_tokens,
        activeWindow.airdrop_id?.toString(),
        activeWindow.airdrop_window_id?.toString(),
        signature
      );
      return txn;
    };

    const saveClaimTxn = async (txnHash: string, claimAmount) => {
      await axios.post(API_PATHS.CLAIM_SAVE_TXN, {
        address: account,
        txn_hash: txnHash,
        amount: claimAmount.toString(),
        airdrop_id: activeWindow?.airdrop_id?.toString(),
        airdrop_window_id: activeWindow?.airdrop_window_id?.toString(),
        blockchain_method: blockChainActionTypes.STAKE_AND_CLAIM,
      });
    };

    try {
      // Retreiving Claim Signature from the backend signer service
      const stakeDetails = await getStakeDetails();

      // Using the claim signature and calling the Ethereum Airdrop Contract.
      const txn = await executeStakeMethod(
        stakeDetails.signature,
        stakeDetails.total_eligible_amount,
        stakeDetails.claimable_amount,
        stakeDetails.staking_contract_address,
        stakeDetails.token_address,
        stakeDetails.user_address,
        stakeDetails.contract_address
      );

      await saveClaimTxn(txn.hash, stakeDetails.claimable_amount);
      setClaimStatus(ClaimStatus.PENDING);
      const receipt = await txn.wait();
      if (receipt.status) {
        setUserRegistered(true);
        setClaimStatus(ClaimStatus.SUCCESS);
        setUiAlert({
          type: AlertTypes.success,
          message: 'Staked and Claimed successfully',
        });
      }
    } catch (error: any) {
      if (error instanceof APIError) {
        setUiAlert({ type: AlertTypes.error, message: error.message });
        return;
      }
      const ethersError = parseEthersError(error);
      if (ethersError) {
        setUiAlert({
          type: AlertTypes.error,
          message: `Failed Contract: ${ethersError}`,
        });
        return;
      }
      setUiAlert({
        type: AlertTypes.error,
        message: `Failed Uncaught: ${error.message}`,
      });
    }
  };

  const handleClaim = async () => {
    if (
      typeof activeWindow?.airdrop_id === 'undefined' ||
      typeof activeWindow.airdrop_window_id === 'undefined' ||
      !account ||
      !library
    ) {
      return;
    }

    if (claimStatus === ClaimStatus.PENDING) {
      setUiAlert({
        type: AlertTypes.error,
        message: { AIRDROP_PENDING_CLAIM_STRING },
      });
      return;
    } else if (claimStatus === ClaimStatus.SUCCESS) {
      setUiAlert({
        type: AlertTypes.error,
        message: 'You have already Claimed',
      });
      return;
    }

    const getClaimDetails = async () => {
      try {
        const response: any = await axios.post(API_PATHS.CLAIM_SIGNATURE, {
          address: account,
          airdrop_id: activeWindow.airdrop_id.toString(),
          airdrop_window_id: activeWindow.airdrop_window_id.toString(),
        });

        return response.data.data;
      } catch (error: any) {
        const backendErrorMessage = error?.errorText?.error?.message;
        if (backendErrorMessage) {
          throw new APIError(backendErrorMessage);
        }
        throw error;
      }
    };

    const executeClaimMethod = async (
      contractAddress: string,
      tokenAddress: string,
      signature: string,
      totalEligibleAmount: string,
      claimAmount: string
    ): Promise<TransactionResponse> => {
      const txn = await airdropContract.claim(
        contractAddress,
        tokenAddress,
        totalEligibleAmount,
        claimAmount,
        activeWindow.airdrop_id?.toString(),
        activeWindow.airdrop_window_id?.toString(),
        signature
      );
      return txn;
    };

    const saveClaimTxn = async (txnHash: string, claimAmount) => {
      await axios.post(API_PATHS.CLAIM_SAVE_TXN, {
        address: account,
        txn_hash: txnHash,
        amount: claimAmount.toString(),
        airdrop_id: activeWindow?.airdrop_id?.toString(),
        airdrop_window_id: activeWindow?.airdrop_window_id?.toString(),
        blockchain_method: TRANSACTION_TYPE.ADA_TRANSFER,
      });
    };

    try {
      // Retreiving Claim Signature from the backend signer service
      const claimDetails = await getClaimDetails();
      const { signature } = await ethSign.getSignature([Number(activeWindow?.airdrop_window_id), registrationId]);
      const matadata = {
        signature,
        airdropWindowId: activeWindow?.airdrop_window_id?.toString(),
        registrationId,
      };
      const depositAmount = new BigNumber(claimDetails.chain_context.amount).times(10 ** 6).toFixed();
      const txnHash = await transferTokens('nami', claimDetails.chain_context.deposit_address, depositAmount, matadata);
      await saveClaimTxn(txnHash, claimDetails.chain_context.amount);
      toggleClaimSuccessModal();
      getClaimHistory();
    } catch (error: any) {
      if (error instanceof APIError) {
        setUiAlert({ type: AlertTypes.error, message: error.message });
        return;
      }
      const ethersError = parseEthersError(error);
      if (ethersError) {
        setUiAlert({
          type: AlertTypes.error,
          message: `Failed Contract: ${ethersError}`,
        });
        return;
      }
      setUiAlert({
        type: AlertTypes.error,
        message: `Failed Uncaught: ${error.message || error.info || error}`,
      });
    }
  };

  // REFERENCE: Working Signature code. Delete it once the new signature logic is working
  // const signTransaction = async (account: string) => {
  //   // if (!library || !account) return;

  //   // const message = solidityKeccak256(
  //   //   ["uint8", "uint8", "address"],
  //   //   [Number(airdropId), Number(airdropWindowId), account]
  //   // );

  //   // const bytesDataHash = arrayify(message);

  //   // const signer = await library.getSigner(account);
  //   // const signature = await signer.signMessage(bytesDataHash);

  //   const signature = await ethSign.sign(
  //     ["uint8", "uint8", "address"],
  //     [Number(airdropId), Number(airdropWindowId), account]
  //   );

  //   return signature;
  // };

  const airdropUserRegistration = async (
    address: string,
    blockNumber: number,
    signature: string,
    cardanoAddress: string
  ) => {
    try {
      const payload = {
        signature,
        address,
        airdrop_id: activeWindow?.airdrop_id,
        airdrop_window_id: activeWindow?.airdrop_window_id,
        block_number: blockNumber,
        cardano_address: cardanoAddress,
      };
      await axios.post('airdrop/registration', payload).then((response) => {
        if (response?.data?.data?.length) {
          const [{ receipt }] = response.data.data.filter(
            (item) => item.airdrop_window_id === activeWindow?.airdrop_window_id
          );
          setRegistrationId(receipt);
        }
      });
    } catch (error: any) {
      throw error?.errorText?.error || new Error(error);
    }
  };

  const toggleRegistrationSuccessModal = () => {
    setShowRegistrationSuccess(!showRegistrationSuccess);
  };

  const toggleClaimSuccessModal = () => {
    setShowClaimSuccess(!showClaimSuccess);
  };

  if (!activeWindow) {
    return null;
  }

  const windowOrder =
    activeWindow.airdrop_window_status === WindowStatus.LAST_CLAIM || (cardanoWalletAddress && !claimInitiated)
      ? activeWindow.airdrop_window_order
      : activeWindow.airdrop_window_order + 1;

  if (!account && (activeWindow !== null || activeWindow !== undefined)) {
    return (
      <Container className={classes.registrationMainContainer}>
        <Grid container spacing={2} mb={8}>
          <Grid item xs={12} sm={12} md={6}>
            <Airdropinfo blogLink={AIRDROP_LINKS.WHITEPAPER} />
          </Grid>
          <Grid item xs={12} sm={12} md={6}>
            <AirdropRegistrationMini
              windowMessage={windowStatusLabelMap[activeWindow.airdrop_window_status]}
              startDate={endDate}
              windowAction={windowStatusActionMap[activeWindow.airdrop_window_status]}
              tokenName={airdropTotalTokens.name}
              totalTokens={airdropTotalTokens.value}
              totalAirdropWindows={totalWindows}
              currentAirdropWindow={windowOrder}
              onViewNotification={onViewNotification}
            />
          </Grid>
        </Grid>
      </Container>
    );
  }

  if (userEligibility === UserEligibility.PENDING) {
    return (
      <Box sx={{ px: [0, 4, 15] }}>
        <AirdropRegistrationLoader />
      </Box>
    );
  }

  const showMini =
    activeWindow.airdrop_window_status == WindowStatus.UPCOMING && activeWindow.airdrop_window_order === 1;

  return !showMini ? (
    <Box sx={{ px: [0, 4, 15] }}>
      <RegistrationSuccessModal
        showModal={showRegistrationSuccess}
        registrationId={registrationId}
        onCloseModal={toggleRegistrationSuccessModal}
      />
      <ClaimSuccessModal
        showModal={showClaimSuccess}
        currentWindow={activeWindow?.airdrop_window_order}
        totalWindow={totalWindows}
        onCloseModal={toggleClaimSuccessModal}
      />
      <AirdropRegistration
        windowOrder={windowOrder}
        totalWindows={totalWindows}
        airdropWindowTotalTokens={activeWindow.airdrop_window_total_tokens}
        endDate={endDate}
        onRegister={handleRegistration}
        onViewRules={onViewRules}
        onViewSchedule={onViewSchedule}
        history={airdropHistory}
        onClaim={handleClaim}
        onAutoStake={handleAutoStake}
        stakeInfo={stakeDetails}
        airdropWindowStatus={activeWindow.airdrop_window_status}
        uiAlert={uiAlert}
        activeWindow={activeWindow}
        airdropWindowrewards={airdropWindowrewards}
        isRegistered={userRegistered}
        setUiAlert={setUiAlert}
        userEligibility={userEligibility}
        isClaimInitiated={claimInitiated}
        claimedWindow={claimedWindow}
      />
    </Box>
  ) : (
    <Grid container spacing={2} px={4} mt={2} mb={8}>
      <Grid item xs={12} sm={6}>
        <Airdropinfo blogLink={AIRDROP_LINKS.WHITEPAPER} />
      </Grid>
      <Grid item xs={12} sm={6}>
        <AirdropRegistrationMini
          windowMessage={windowStatusLabelMap[activeWindow.airdrop_window_status]}
          startDate={moment.utc(`${activeWindow.airdrop_window_registration_start_period}`)}
          windowAction={windowStatusActionMap[activeWindow.airdrop_window_status]}
          tokenName={airdropTotalTokens.name}
          totalTokens={airdropTotalTokens.value}
          totalAirdropWindows={totalWindows}
          currentAirdropWindow={windowOrder}
          onViewNotification={onViewNotification}
        />
      </Grid>
    </Grid>
  );
};

export default Registration;
